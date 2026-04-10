"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyRefreshToken = exports.verifyAccessToken = exports.generateRefreshToken = exports.generateAccessToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'dev-access-secret-change-me';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me';
const ACCESS_EXPIRES = (process.env.JWT_ACCESS_EXPIRES_IN || '15m');
const REFRESH_EXPIRES = (process.env.JWT_REFRESH_EXPIRES_IN || '30d');
function generateAccessToken(userId) {
    return jsonwebtoken_1.default.sign({ userId }, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES });
}
exports.generateAccessToken = generateAccessToken;
function generateRefreshToken(userId) {
    return jsonwebtoken_1.default.sign({ userId }, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES });
}
exports.generateRefreshToken = generateRefreshToken;
function verifyAccessToken(token) {
    return jsonwebtoken_1.default.verify(token, ACCESS_SECRET);
}
exports.verifyAccessToken = verifyAccessToken;
function verifyRefreshToken(token) {
    return jsonwebtoken_1.default.verify(token, REFRESH_SECRET);
}
exports.verifyRefreshToken = verifyRefreshToken;
//# sourceMappingURL=jwt.js.map