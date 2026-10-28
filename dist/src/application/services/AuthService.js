"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const UserRepository_1 = require("../../infrastructure/sqlite/repositories/UserRepository");
class AuthService {
    userRepo;
    currentUser = null;
    constructor(userRepo = new UserRepository_1.UserRepository()) {
        this.userRepo = userRepo;
    }
    login(username, passwordPlain) {
        const user = this.userRepo.findByUsername(username);
        if (!user) {
            throw new Error('Invalid username or password');
        }
        const isMatch = bcryptjs_1.default.compareSync(passwordPlain, user.passwordHash);
        if (!isMatch) {
            throw new Error('Invalid username or password');
        }
        const safeUser = {
            id: user.id,
            username: user.username,
            fullName: user.fullName,
            role: user.role,
            isActive: user.isActive,
            createdAt: user.createdAt
        };
        this.currentUser = safeUser;
        return safeUser;
    }
    getCurrentUser() {
        return this.currentUser;
    }
    logout() {
        this.currentUser = null;
    }
    listUsers() {
        return this.userRepo.list();
    }
    createUser(userData) {
        const salt = bcryptjs_1.default.genSaltSync(10);
        const passwordHash = bcryptjs_1.default.hashSync(userData.passwordPlain, salt);
        return this.userRepo.create({
            username: userData.username,
            passwordHash,
            fullName: userData.fullName,
            role: userData.role
        });
    }
    updatePassword(userId, newPasswordPlain) {
        const salt = bcryptjs_1.default.genSaltSync(10);
        const passwordHash = bcryptjs_1.default.hashSync(newPasswordPlain, salt);
        this.userRepo.updatePassword(userId, passwordHash);
    }
}
exports.AuthService = AuthService;
