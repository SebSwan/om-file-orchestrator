# Weather Data Orchestrator

A powerful Node.js application for automatically downloading and managing weather data files from OpenMeteo's spatial data API. This orchestrator supports multiple weather models, priority-based downloads, automatic cleanup, and comprehensive testing.

## 🚀 Features

### Core Functionality
- **Multi-Model Support**: Download data from 50+ weather models (DWD, ECMWF, MeteoFrance, NCEP, etc.)
- **Automatic Scheduling**: Cron-based scheduling for regular data checks and downloads
- **Priority Downloads**: Queue-based system with priority levels for urgent downloads
- **Automatic Cleanup**: Configurable retention periods with automatic file cleanup
- **Fake Mode**: Simulation mode for testing without actual downloads
- **Local Caching**: LMDB-based caching for fast file path resolution
- **Comprehensive Logging**: Detailed logging with Winston for monitoring and debugging

### Advanced Features
- **Permission Testing**: Pre-deployment permission validation
- **Queue Management**: Separate queues for downloads and cleanup operations
- **Error Handling**: Robust error handling with retry logic
- **Statistics Tracking**: Real-time statistics for monitoring performance
- **Graceful Shutdown**: Clean shutdown with queue completion

## 📋 Supported Weather Models

The orchestrator supports 50+ weather models including:

- **DWD Models**: ICON, ICON D2, ICON EU, ICON EPS, EWAM, GWAM
- **ECMWF Models**: IFS025, AIFS025, WAM025 (single and ensemble)
- **MeteoFrance Models**: AROME France, ARPEGE Europe/World, Currents, Wave
- **NCEP Models**: GFS, GEFS, HRRR, NAM, NBM
- **Regional Models**: MeteoSwiss ICON, KNMI HARMONIE, DMI HARMONIE
- **Air Quality**: CAMS Europe/Global, CAMS Greenhouse Gases
- **And many more...**

## 🛠️ Installation

### Prerequisites
- Node.js 16+
- npm or yarn

### As a Library (Recommended)
```bash
# Install from npm
npm install om-file-orchestrator

# Or install from GitHub
npm install github:Sebswan/om-file-orchestrator
```

### As a Standalone Application
```bash
# Clone the repository
git clone <repository-url>
cd om-file-orchestrator

# Install dependencies
npm install

# Run setup script
npm run setup

# Test permissions
npm run test:quick
```

## ⚙️ Configuration

### Main Configuration (`config.json`)
```json
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
    "maxFileSize": 30971520
  },
  "logging": {
    "level": "info",
    "file": "./logs/orchestrator.log"
  },
  "lmdb": {
    "path": "./cache/lmdb",
    "mapSize": 104857600
  }
}
```

### Model Configuration (`config_model.json`)
Each model can be configured with:
- `enabled`: Enable/disable the model
- `retentionHours`: File retention period in hours
- `checkInterval`: Cron expression for checking frequency
- `baseUrl`: Base URL for the model's data
- `statusFile`: Path to the in-progress status file

## 🚀 Usage

### As a Library
```javascript
const { createOrchestratorWithDefaults } = require('om-file-orchestrator');

// Create orchestrator with defaults
const orchestrator = createOrchestratorWithDefaults({
  cacheDir: './weather-cache',
  concurrency: 2,
  logLevel: 'info',
  fakeMode: false
});

// Start orchestrator
await orchestrator.start();

// Download file with priority
await orchestrator.downloadWithPriority(
  'dwd_icon_d2/2025/09/11/0600Z/2025-09-11T0600.om',
  1 // High priority
);

// Get statistics
const stats = orchestrator.getStats();

// Stop orchestrator
await orchestrator.stop();
```

### As a Standalone Application
```bash
# Start the orchestrator
npm start

# Start with immediate check
npm run dev

# Start in fake mode (no real downloads)
npm run start:fake
```

### Examples
```bash
# Run examples
npm run example:simple      # Basic usage example
npm run example:fastify     # Fastify integration example
npm run example:custom      # Custom configuration example
```

### Priority Downloads
```javascript
// Download with high priority
await orchestrator.downloadWithPriority(
  'dwd_icon_d2/2025/09/11/0600Z/2025-09-11T0600.om',
  1  // Priority level (0=normal, 1=high, 2=max)
);
```

### Manual Operations
```javascript
// Manual cleanup
await orchestrator.cleanupNow();

// Manual check for specific model
await orchestrator.checkNow('dwd_icon_d2');

// Get statistics
const stats = orchestrator.getStats();
```

## 🧪 Testing

### Test Suite
```bash
# Run all tests
npm test

# Quick permission test
npm run test:quick

# Test priority system
npm run test:priority

# Test specific scenarios
# Test specific scenarios
npm run test:permissions

# Verify LMDB logic
node test/verify-lmdb-crud.js     # Test Set/Get/Cleanup
node test/verify-lmdb-rebuild.js  # Test Index Rebuild
```

### Test Coverage
- **Permission Tests**: Validates write/read/delete permissions
- **File Operations**: Tests file creation, reading, and deletion
- **Concurrent Operations**: Tests simultaneous file operations
- **Large File Handling**: Tests with large files (1MB+)
- **Priority System**: Tests download priority ordering
- **Subdirectory Creation**: Tests nested directory structure

## 📊 Monitoring

### Statistics
The orchestrator provides real-time statistics:
```
📊 Statistics:
  Files checked: 49
  Files downloaded: 12
  Files skipped: 37
  Files deleted: 8
  Errors: 0
  Cleanup errors: 0
  Download queue: 0 (0 pending)
  Cleanup queue: 0 (0 pending)
  Last check: Thu Sep 11 2025 12:30:00 GMT+0200
  Last cleanup: Thu Sep 11 2025 12:00:00 GMT+0200
```

### Logging
- **Console Output**: Real-time status updates
- **File Logging**: Detailed logs saved to `./logs/orchestrator.log`
- **Log Levels**: debug, info, warn, error
- **Log Rotation**: Automatic log rotation (5MB max, 5 files)

## 🔧 Advanced Configuration

### Queue Configuration
```json
{
  "queue": {
    "concurrency": 2,        // Parallel downloads
    "interval": 1000,        // Interval between downloads (ms)
    "intervalCap": 10,       // Max downloads per interval
    "timeout": 60000,        // Download timeout (ms)
    "retries": 3             // Retry attempts
  }
}
```

### Cleanup Configuration
- **Automatic Cleanup**: Runs every hour via cron
- **Retention Periods**: Configurable per model (3h to 24h+)
- **Cleanup Queue**: Separate queue for file deletions
- **Empty Directory Removal**: Automatically removes empty directories

### Priority System
- **Priority Levels**: 0 (normal), 1 (high), 2 (maximum)
- **Queue Ordering**: Higher priority downloads processed first
- **Priority Logging**: Clear indication of priority downloads

### Caching System (LMDB)
### Caching System (LMDB)
- **Embedded Database**: Uses LMDB for high-performance, serverless caching
- **Path Resolution**: Stores mappings between timestamps and file paths
- **Persistence**: Rebuilds index from disk on startup to ensure consistency across deployments
- **Memory Efficient**: Separate databases per model
- **Automatic Cleanup**: Removes expired keys synchronously with file cleanup

## 🐛 Troubleshooting

### Common Issues

#### Permission Errors
```bash
# Test permissions
npm run test:quick

# Fix permissions
chmod 755 cache/
sudo chown -R $USER:$USER cache/
```

#### Network Issues
- Check internet connectivity
- Verify model URLs are accessible
- Review timeout settings in config

#### Storage Issues
```bash
# Check disk space
df -h

# Clean cache if needed
rm -rf cache/*
```

### Debug Mode
Enable debug logging by setting log level to "debug" in `config.json`:
```json
{
  "logging": {
    "level": "debug"
  }
}
```

## 📁 Project Structure

```
om-file-orchestrator/
├── cache/                    # Downloaded files
├── logs/                     # Log files
├── test/                     # Test suite
│   ├── test-permissions.js   # Permission tests
│   ├── test-scenarios.js     # Comprehensive tests
│   ├── test-priority.js      # Priority system tests
│   └── README.md            # Test documentation
├── config.json              # Main configuration
├── config_model.json        # Model configurations
├── WeatherOrchestratorSimple.js  # Main orchestrator class
├── index.js                 # Application entry point
├── package.json             # Dependencies and scripts
└── README.md               # This file
```

## 🔄 API Reference

### WeatherOrchestratorSimple Class

#### Constructor
```javascript
new WeatherOrchestratorSimple(config, modelConfig, fakeMode)
```

#### Methods
- `start()`: Start the orchestrator
- `stop()`: Stop the orchestrator gracefully
- `checkNow(modelKey)`: Manual check for specific model
- `cleanupNow()`: Manual cleanup trigger
- `downloadWithPriority(filePath, priority)`: Download with priority
- `getStats()`: Get current statistics
- `getQueueInfo()`: Get queue information

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## 📄 License

This project is licensed under the ISC License.

## 🆘 Support

For issues and questions:
1. Check the troubleshooting section
2. Review the test suite for examples
3. Enable debug logging for detailed information
4. Create an issue with logs and configuration details

## 🎯 Roadmap

- [ ] Web dashboard for monitoring
- [ ] REST API for remote control
- [ ] Database integration for metadata
- [ ] Docker containerization
- [ ] Kubernetes deployment support
- [ ] Advanced scheduling options
- [ ] Data validation and integrity checks
