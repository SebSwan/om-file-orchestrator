const PQueue = require("p-queue").default;
const cron = require("node-cron");
const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");
const winston = require("winston");

class WeatherOrchestratorSimple {
  constructor(config, modelConfig, fakeMode = false) {
    this.config = config;
    this.modelConfig = modelConfig;
    this.fakeMode = fakeMode;
    this.scheduledTasks = new Map();

    // Initialiser le logger
    this.setupLogger();

    // Initialiser la queue de téléchargement
    this.downloadQueue = new PQueue({
      concurrency: config.queue.concurrency,
      interval: config.queue.interval,
      intervalCap: config.queue.intervalCap,
      timeout: config.queue.timeout,
      throwOnTimeout: true,
    });

    // Stats
    this.stats = {
      filesChecked: 0,
      filesDownloaded: 0,
      filesSkipped: 0,
      errors: 0,
      lastCheck: null,
    };

    // Setup des événements de queue
    this.setupQueueEvents();
  }

  setupLogger() {
    this.logger = winston.createLogger({
      level: this.config.logging.level,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : "";
          return `${timestamp} [${level.toUpperCase()}]: ${message} ${metaStr}`;
        })
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({
          filename: this.config.logging.file,
          maxsize: 5242880, // 5MB
          maxFiles: 5,
        }),
      ],
    });
  }

  setupQueueEvents() {
    this.downloadQueue.on("active", () => {
      this.logger.debug(
        `Queue active - Size: ${this.downloadQueue.size}, Pending: ${this.downloadQueue.pending}`
      );
    });

    this.downloadQueue.on("idle", () => {
      this.logger.info("Download queue is idle");
    });
  }

  async testPermissions() {
    this.logger.info("🔍 Testing write permissions...");

    const testFilePath = path.join(this.config.storage.cacheDir, "test.txt");
    const testContent = "Permission test - " + new Date().toISOString();

    try {
      // Test d'écriture
      await fs.writeFile(testFilePath, testContent);
      this.logger.debug(`✅ Write test successful: ${testFilePath}`);

      // Test de lecture
      const readContent = await fs.readFile(testFilePath, 'utf8');
      if (readContent !== testContent) {
        throw new Error("Read content doesn't match written content");
      }
      this.logger.debug(`✅ Read test successful: content matches`);

      // Test de suppression
      await fs.remove(testFilePath);
      this.logger.debug(`✅ Delete test successful: ${testFilePath}`);

      this.logger.info("✅ All permission tests passed - cache directory is writable");

    } catch (error) {
      this.logger.error("❌ Permission test failed!");
      this.logger.error(`   Cache directory: ${this.config.storage.cacheDir}`);
      this.logger.error(`   Test file: ${testFilePath}`);
      this.logger.error(`   Error: ${error.message}`);

      // Nettoyer le fichier test s'il existe encore
      try {
        await fs.remove(testFilePath);
      } catch (cleanupError) {
        this.logger.warn(`⚠️  Could not clean up test file: ${cleanupError.message}`);
      }

      throw new Error(`Permission test failed: ${error.message}`);
    }
  }

  async start() {
    this.logger.info(
      "🚀 Starting Weather Orchestrator (Simple Version - No MongoDB)..."
    );

    if (this.fakeMode) {
      this.logger.info("🎭 FAKE MODE: Downloads will be simulated with empty .txt files");
    }

    // Créer les dossiers nécessaires
    await fs.ensureDir(this.config.storage.cacheDir);
    await fs.ensureDir(path.dirname(this.config.logging.file));

    // Tester les permissions d'écriture
    await this.testPermissions();

    // Programmer les tâches pour chaque modèle
    for (const [modelKey, model] of Object.entries(this.modelConfig.models)) {
      if (model.enabled) {
        this.scheduleModel(modelKey, model);
      }
    }

    this.logger.info("✅ Weather Orchestrator started successfully");
    this.logger.info(`📅 Scheduled tasks: ${this.scheduledTasks.size}`);
  }

  scheduleModel(modelKey, model) {
    // Convertir l'intervalle cron ou utiliser un intervalle simple
    let cronExpression = model.checkInterval;

    // Si c'est un nombre (millisecondes), convertir en cron
    if (!isNaN(model.checkInterval)) {
      const minutes = Math.floor(model.checkInterval / 60000);
      cronExpression = `*/${minutes} * * * *`;
    }

    // Valider l'expression cron
    if (!cron.validate(cronExpression)) {
      this.logger.error(
        `Invalid cron expression for ${model.name}: ${cronExpression}`
      );
      return;
    }

    // Créer la tâche planifiée
    const task = cron.schedule(cronExpression, async () => {
      this.logger.info(`⏰ Running scheduled check for model: ${model.name}`);
      try {
        await this.checkAndDownloadModel(modelKey, model);
      } catch (error) {
        this.logger.error(
          `Error in scheduled task for ${model.name}:`,
          error.message
        );
      }
    });

    // Démarrer la tâche
    task.start();

    // Sauvegarder la référence pour pouvoir l'arrêter plus tard
    this.scheduledTasks.set(modelKey, task);

    this.logger.info(`📅 Scheduled ${model.name} with cron: ${cronExpression}`);
  }

  async checkAndDownloadModel(modelKey, model) {
    try {
      this.stats.lastCheck = new Date();

      // Récupérer le fichier de status
      const statusUrl = `${model.baseUrl}${model.statusFile}`;
      this.logger.debug(`Fetching status from: ${statusUrl}`);

      const response = await axios.get(statusUrl, {
        timeout: 10000, // 10 secondes timeout pour le check
      });
      const statusData = response.data;

      if (!statusData.completed) {
        this.logger.info(`⏳ Model ${model.name} is not completed yet`);
        return;
      }

      this.logger.info(
        `📦 Found ${statusData.valid_times.length} valid times for ${model.name}`
      );

      // Debug: afficher les premiers valid_times
      this.logger.debug(`Debug - reference_time: "${statusData.reference_time}"`);
      this.logger.debug(`Debug - first 3 valid_times: ${JSON.stringify(statusData.valid_times.slice(0, 3))}`);

      // Parser les valid_times et créer les jobs de téléchargement
      let newFiles = 0;
      for (const validTime of statusData.valid_times) {
        const isNew = await this.processValidTime(
          modelKey,
          model,
          validTime,
          statusData.reference_time
        );
        if (isNew) newFiles++;
      }

      this.stats.filesChecked += statusData.valid_times.length;

      if (newFiles > 0) {
        this.logger.info(`🆕 ${newFiles} new files queued for download`);
      } else {
        this.logger.info(`✓ All files already in cache`);
      }
    } catch (error) {
      this.stats.errors++;
      if (error.code === "ECONNABORTED") {
        this.logger.error(`Timeout checking model ${model.name}`);
      } else if (error.response?.status === 404) {
        this.logger.warn(`Status file not found for ${model.name}`);
      } else {
        this.logger.error(`Error checking model ${model.name}:`, error.message);
      }
    }
  }

  async processValidTime(modelKey, model, validTime, referenceTime) {
    // Parser les dates
    const refDate = new Date(referenceTime);

    // Construire le chemin du fichier
    const year = refDate.getFullYear();
    const month = String(refDate.getMonth() + 1).padStart(2, "0");
    const day = String(refDate.getDate()).padStart(2, "0");
    const runHour = String(refDate.getUTCHours()).padStart(2, "0") + "00Z";
    this.logger.debug(`Debug - validTime: "${validTime}"`);
    // Transformer "2025-09-11T06:00Z" en "2025-09-11T0600"
    const forecastTime = validTime.replace(/:/g, "").replace(/Z$/, "");
    this.logger.debug(`Debug - forecastTime: "${forecastTime}"`);

    // Chemin relatif dans le cache
    const relativePath = `${modelKey}/${year}/${month}/${day}/${runHour}/${forecastTime}${model.fileExtension}`;
    const localPath = path.join(this.config.storage.cacheDir, relativePath);

    // Vérifier si le fichier existe déjà
    const checkPath = this.fakeMode ? localPath.replace(/\.om$/, '.txt') : localPath;
    if (await fs.pathExists(checkPath)) {
      this.logger.debug(`📁 File already exists, skipping: ${relativePath}`);
      this.stats.filesSkipped++;
      return false;
    }

    // URL source
    const sourceUrl = `${model.baseUrl}/${year}/${month}/${day}/${runHour}/${forecastTime}${model.fileExtension}`;

    // Ajouter à la queue de téléchargement
    await this.downloadQueue.add(async () => {
      if (this.fakeMode) {
        await this.fakeDownloadFile(sourceUrl, localPath, relativePath);
      } else {
        await this.downloadFile(sourceUrl, localPath, relativePath);
      }
    });

    return true;
  }

  async downloadFile(sourceUrl, localPath, relativePath) {
    const startTime = Date.now();

    try {
      this.logger.info(`⬇️  Downloading: ${relativePath}`);

      // Créer le dossier si nécessaire
      await fs.ensureDir(path.dirname(localPath));

      // Télécharger avec axios en streaming
      const response = await axios({
        method: "GET",
        url: sourceUrl,
        responseType: "stream",
        timeout: this.config.queue.timeout,
        maxContentLength: this.config.storage.maxFileSize,
        maxBodyLength: this.config.storage.maxFileSize,
      });

      // Créer un fichier temporaire
      const tempPath = `${localPath}.tmp`;
      const writer = fs.createWriteStream(tempPath);

      // Variables pour le tracking
      let downloadedBytes = 0;
      let lastLoggedPercent = 0;

      // Tracker le progress
      response.data.on("data", (chunk) => {
        downloadedBytes += chunk.length;

        // Log tous les 25%
        if (response.headers["content-length"]) {
          const totalBytes = parseInt(response.headers["content-length"]);
          const percent = Math.floor((downloadedBytes / totalBytes) * 100);

          if (percent >= lastLoggedPercent + 25) {
            lastLoggedPercent = Math.floor(percent / 25) * 25;
            this.logger.debug(`  📊 Progress ${relativePath}: ${percent}%`);
          }
        }

        // Vérifier la taille max
        if (downloadedBytes > this.config.storage.maxFileSize) {
          writer.destroy();
          throw new Error(`File too large: ${downloadedBytes} bytes`);
        }
      });

      // Pipe le stream
      response.data.pipe(writer);

      // Attendre la fin du téléchargement
      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
        response.data.on("error", reject);
      });

      // Renommer le fichier temporaire
      await fs.move(tempPath, localPath, { overwrite: false });

      const duration = Date.now() - startTime;
      const sizeMB = (downloadedBytes / 1024 / 1024).toFixed(2);

      this.stats.filesDownloaded++;
      this.logger.info(
        `✅ Downloaded: ${relativePath} (${sizeMB} MB in ${duration}ms)`
      );
    } catch (error) {
      this.stats.errors++;

      // Nettoyer les fichiers temporaires
      try {
        await fs.remove(`${localPath}.tmp`);
      } catch (e) {
        // Ignorer les erreurs de nettoyage
      }

      if (error.response?.status === 404) {
        this.logger.warn(`❌ File not found: ${sourceUrl}`);
      } else if (error.code === "ECONNABORTED") {
        this.logger.error(`⏱️  Download timeout: ${relativePath}`);
      } else {
        this.logger.error(
          `❌ Failed to download ${relativePath}:`,
          error.message
        );
      }

      throw error;
    }
  }

  async fakeDownloadFile(sourceUrl, localPath, relativePath) {
    const startTime = Date.now();

    try {
      this.logger.info(`🎭 [FAKE] Simulating download: ${relativePath}`);

      // Créer le dossier si nécessaire
      await fs.ensureDir(path.dirname(localPath));

      // Remplacer l'extension .om par .txt pour le fichier fake
      const fakePath = localPath.replace(/\.om$/, '.txt');

      // Créer un fichier vide
      await fs.writeFile(fakePath, '');

      // Simuler le temps de téléchargement (20 secondes)
      this.logger.debug(`🎭 [FAKE] Waiting 20 seconds to simulate download...`);
      await new Promise(resolve => setTimeout(resolve, 20000));

      const duration = Date.now() - startTime;

      this.stats.filesDownloaded++;
      this.logger.info(
        `✅ [FAKE] Simulated download: ${relativePath.replace(/\.om$/, '.txt')} (0 bytes in ${duration}ms)`
      );
    } catch (error) {
      this.stats.errors++;
      this.logger.error(
        `❌ [FAKE] Failed to simulate download ${relativePath}:`,
        error.message
      );
      throw error;
    }
  }

  async stop() {
    this.logger.info("🛑 Stopping Weather Orchestrator...");

    // Arrêter toutes les tâches cron
    for (const [modelKey, task] of this.scheduledTasks) {
      task.stop();
      this.logger.debug(`Stopped scheduler for ${modelKey}`);
    }

    // Attendre que la queue finisse
    await this.downloadQueue.onIdle();

    this.logger.info("👋 Weather Orchestrator stopped");
  }

  getStats() {
    return {
      ...this.stats,
      queue: {
        size: this.downloadQueue.size,
        pending: this.downloadQueue.pending,
      },
      schedulers: this.scheduledTasks.size,
    };
  }

  // Déclencher un check manuel
  async checkNow(modelKey) {
    const model = this.modelConfig.models[modelKey];
    if (!model) {
      throw new Error(`Model ${modelKey} not found`);
    }

    this.logger.info(`🔄 Manual check triggered for ${model.name}`);
    await this.checkAndDownloadModel(modelKey, model);
  }
}

module.exports = WeatherOrchestratorSimple;
