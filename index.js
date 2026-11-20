const WeatherOrchestrator = require("./WeatherOrchestratorSimple");
const {loadConfigurations} = require("./lib");
const args = require("node:util").parseArgs({allowPositionals:true,options:{config:{type:"string",default:"./config.json"},models:{type:"string"},fake:{type:"boolean"},immediate:{type:"boolean"}});
const {config, modelConfig} = loadConfigurations(args.values.config,args.values.models);

// Instance globale
let orchestrator;

async function main() {
  // Détecter le mode fake
  const isFakeMode = process.argv.includes("--fake");

  console.log("🚀 Starting Weather Data Orchestrator POC");
  console.log("📌 No Database Required - Everything in Memory!");
  if (isFakeMode) {
    console.log("🎭 FAKE MODE ENABLED - No real downloads, creating empty .txt files");
  }
  console.log("================================================");

  // Créer l'orchestrateur avec le mode fake
  orchestrator = new WeatherOrchestrator(config, modelConfig, isFakeMode);

  // Démarrer
  await orchestrator.start();

  // Afficher les stats toutes les 30 secondes
  setInterval(() => {
    const stats = orchestrator.getStats();
    console.log("\n📊 Statistics:");
    console.log(`  Files checked: ${stats.filesChecked}`);
    console.log(`  Files downloaded: ${stats.filesDownloaded}`);
    console.log(`  Files skipped: ${stats.filesSkipped}`);
    console.log(`  Files deleted: ${stats.filesDeleted}`);
    console.log(`  Errors: ${stats.errors}`);
    console.log(`  Cleanup errors: ${stats.cleanupErrors}`);
    console.log(`  Download queue: ${stats.queue.size} (${stats.queue.pending} pending)`);
    console.log(`  Cleanup queue: ${stats.cleanupQueue.size} (${stats.cleanupQueue.pending} pending)`);
    console.log(`  Last check: ${stats.lastCheck || "Never"}`);
    console.log(`  Last cleanup: ${stats.lastCleanup || "Never"}`);
  }, 30000);

  // Premier check immédiat (optionnel)
  if (process.argv.includes("--immediate")) {
    console.log("\n🔍 Running immediate check...");
    for (const [modelKey, model] of Object.entries(modelConfig.models)) {
      if (model.enabled) {
        await orchestrator.checkAndDownloadModel(modelKey, model);
      }
    }
  }
}

// Gestion du shutdown gracieux
async function shutdown(signal) {
  console.log(`\n⚠️  Received ${signal}, shutting down gracefully...`);

  if (orchestrator) {
    await orchestrator.stop();
  }

  console.log("👋 Goodbye!");
  process.exit(0);
}

// Écouter les signaux de terminaison
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Gestion des erreurs non attrapées
process.on("uncaughtException", (error) => {
  console.error("💥 Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("💥 Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Lancer l'application
main().catch((error) => {
  console.error("💥 Fatal error:", error);
  process.exit(1);
});
