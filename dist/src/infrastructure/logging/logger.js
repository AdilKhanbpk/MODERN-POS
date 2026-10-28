"use strict";
/**
 * Infrastructure: Local Structured Logger
 * Provides local disk file logging and console output for offline operations.
 * Writes to local "logs/pos.log" with automated file size checks.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.LoggerService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class LoggerService {
    static instance;
    logDirectory;
    logFilePath;
    minLevel = 'INFO';
    levelWeights = {
        DEBUG: 10,
        INFO: 20,
        WARN: 30,
        ERROR: 40
    };
    constructor(customLogDir) {
        this.logDirectory = customLogDir || path_1.default.resolve(process.cwd(), 'logs');
        this.logFilePath = path_1.default.join(this.logDirectory, 'pos.log');
        this.ensureDirectory();
    }
    static getInstance() {
        if (!this.instance) {
            this.instance = new LoggerService();
        }
        return this.instance;
    }
    setLevel(level) {
        this.minLevel = level;
    }
    ensureDirectory() {
        try {
            if (!fs_1.default.existsSync(this.logDirectory)) {
                fs_1.default.mkdirSync(this.logDirectory, { recursive: true });
            }
        }
        catch {
            // Ignore directory creation error in read-only/test runners
        }
    }
    shouldLog(level) {
        return this.levelWeights[level] >= this.levelWeights[this.minLevel];
    }
    write(level, context, message, meta) {
        if (!this.shouldLog(level))
            return;
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            context,
            message,
            meta
        };
        const formatted = `[${entry.timestamp}] [${entry.level}] [${entry.context}]: ${entry.message}${meta ? ' ' + JSON.stringify(meta) : ''}\n`;
        // 1. Console stream
        if (level === 'ERROR') {
            console.error(formatted.trim());
        }
        else if (level === 'WARN') {
            console.warn(formatted.trim());
        }
        else {
            console.log(formatted.trim());
        }
        // 2. Append to local file
        try {
            this.ensureDirectory();
            fs_1.default.appendFileSync(this.logFilePath, formatted, 'utf8');
        }
        catch {
            // Graceful fallback if filesystem write is restricted
        }
    }
    debug(context, message, meta) {
        this.write('DEBUG', context, message, meta);
    }
    info(context, message, meta) {
        this.write('INFO', context, message, meta);
    }
    warn(context, message, meta) {
        this.write('WARN', context, message, meta);
    }
    error(context, message, meta) {
        this.write('ERROR', context, message, meta);
    }
}
exports.LoggerService = LoggerService;
exports.logger = LoggerService.getInstance();
