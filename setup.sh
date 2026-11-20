#!/bin/bash

# Couleurs pour l'output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "========================================"
echo -e "${BLUE}  Weather Data Orchestrator POC Setup${NC}"
echo -e "${GREEN}     No Database Required! 🎉${NC}"
echo "========================================"
echo ""

# Vérifier Node.js
echo -n "Checking Node.js... "
if ! command -v node &> /dev/null; then
    echo -e "${RED}NOT FOUND${NC}"
    echo "Please install Node.js 16+ first"
    echo "Visit: https://nodejs.org/"
    exit 1
fi
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 16 ]; then
    echo -e "${YELLOW}Version too old${NC}"
    echo "Please upgrade to Node.js 16+"
    exit 1
fi
echo -e "${GREEN}OK${NC} ($(node -v))"

# Vérifier npm
echo -n "Checking npm... "
if ! command -v npm &> /dev/null; then
    echo -e "${RED}NOT FOUND${NC}"
    echo "npm should come with Node.js installation"
    exit 1
fi
echo -e "${GREEN}OK${NC} ($(npm -v))"

# Créer la structure de dossiers
echo ""
echo "Creating directory structure..."
mkdir -p cache
mkdir -p logs
echo -e "${GREEN}✓${NC} ./cache directory created"
echo -e "${GREEN}✓${NC} ./logs directory created"

# Créer les fichiers de configuration s'ils n'existent pas
if [ ! -f config.json ]; then
    echo ""
    echo "Creating config.json..."
    cat > config.json << 'EOF'
{
  "queue": {
    "concurrency": 1,
    "interval": 1000,
    "intervalCap": 10,
    "timeout": 60000,
    "retries": 3
  },
  "storage": {
    "cacheDir": "./cache",
    "maxFileSize": 20971520
  },
  "logging": {
    "level": "info",
    "file": "./logs/orchestrator.log"
  }
}
EOF
    echo -e "${GREEN}✓${NC} config.json created"
else
    echo -e "${YELLOW}ℹ${NC} config.json already exists"
fi

echo "Model catalogue: use your application's config_model.json with --models /path/config_model.json"
echo "No default model catalogue is created by this library."

# Installer les dépendances npm
echo ""
echo "Installing npm dependencies..."
if npm install; then
    echo -e "${GREEN}✓${NC} Dependencies installed successfully"
else
    echo -e "${RED}✗${NC} Failed to install dependencies"
    exit 1
fi

# Créer les fichiers principaux s'ils n'existent pas
if [ ! -f WeatherOrchestratorSimple.js ]; then
    echo -e "${YELLOW}⚠${NC}  WeatherOrchestratorSimple.js not found"
    echo "   Please ensure you have all the source files"
fi

if [ ! -f index.js ]; then
    echo -e "${YELLOW}⚠${NC}  index.js not found"
    echo "   Please ensure you have all the source files"
fi

echo ""
echo "========================================"
echo -e "${GREEN}✨ Setup complete!${NC}"
echo "========================================"
echo ""
echo -e "${BLUE}Key Features:${NC}"
echo "  • No database required (no MongoDB, no Redis)"
echo "  • Everything runs in memory"
echo "  • Simple cron-based scheduling"
echo "  • Lightweight and fast"
echo ""
echo -e "${BLUE}You can now start the orchestrator:${NC}"
echo ""
echo "  ${GREEN}npm start${NC}                  # Normal start"
echo "  ${GREEN}node index.js --immediate${NC}  # Start with immediate check"
echo "  ${GREEN}npm run dev${NC}                # Development mode with auto-reload"
echo ""
echo -e "${BLUE}Monitor the application:${NC}"
echo ""
echo "  ${GREEN}tail -f logs/orchestrator.log${NC}  # Watch logs"
echo "  ${GREEN}node cli.js status${NC}             # Check statistics"
echo "  ${GREEN}node cli.js list${NC}               # List downloaded files"
echo "  ${GREEN}ls -la cache/${NC}                  # Browse cache directory"
echo ""
echo -e "${BLUE}Configure workers:${NC}"
echo ""
echo "  Edit config.json → queue.concurrency"
echo "  (Default: 1 worker, increase for parallel downloads)"
echo ""
