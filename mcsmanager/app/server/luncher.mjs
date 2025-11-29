// @ts-check
/**
 * 此程序用于启动 MCSManager Web 端和 Daemon 端，并监控进程状态。
 * 
 * 启动 Web 端方式是：
 * 
 * node web/app.js
 * 
 * 启动 Daemon 端方式是：
 * 
 * node daemon/app.js
 * 
 */

import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import { exit } from 'process';
import path from 'path';

const CURRENT_DIR = import.meta.dirname;
/**
 * 日志输出流，用于将日志写入 output.log 文件
 * @type {import('fs').WriteStream}
 */
const logStream = createWriteStream('output.log', { flags: 'a' });

/**
 * 状态标记，防止重复关闭进程
 * @type {boolean}
 */
let isShuttingDown = false;

/**
 * 记录日志到文件和控制台
 * @param {string} message - 日志消息内容
 * @returns {void}
 */
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  process.stdout.write(logMessage);
  logStream.write(logMessage);
}

/**
 * 记录错误日志到文件和标准错误输出
 * @param {string} message - 错误消息内容
 * @returns {void}
 */
function logError(message) {
  const timestamp = new Date().toISOString();
  const errorMessage = `[${timestamp}] [ERROR] ${message}\n`;
  process.stderr.write(errorMessage);
  logStream.write(errorMessage);
}

// 启动子进程
log('正在启动 MCSManager 进程...');

/**
 * Web 端子进程实例
 * @type {import('child_process').ChildProcess}
 */
const webProcess = spawn('node', ['app.js'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  cwd: path.join(CURRENT_DIR, 'web'),
  env: process.env,
});

/**
 * Daemon 端子进程实例
 * @type {import('child_process').ChildProcess}
 */
const daemonProcess = spawn('node', ['app.js'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  cwd: path.join(CURRENT_DIR, 'daemon'),
  env: process.env,
});

log(`Web 进程已启动，PID: ${webProcess.pid}`);
log(`Daemon 进程已启动，PID: ${daemonProcess.pid}`);

// ==================== 处理子进程输出 ====================

/**
 * 处理 Web 进程的标准输出
 * @param {Buffer} data - 进程输出的数据
 */
webProcess.stdout?.on('data', (data) => {
  const message = `[Web] ${data.toString().trim()}`;
  log(message);
});

/**
 * 处理 Web 进程的标准错误输出
 * @param {Buffer} data - 进程输出的错误数据
 */
webProcess.stderr?.on('data', (data) => {
  const message = `[Web ERROR] ${data.toString().trim()}`;
  logError(message);
});

/**
 * 处理 Daemon 进程的标准输出
 * @param {Buffer} data - 进程输出的数据
 */
daemonProcess.stdout?.on('data', (data) => {
  const message = `[Daemon] ${data.toString().trim()}`;
  log(message);
});

/**
 * 处理 Daemon 进程的标准错误输出
 * @param {Buffer} data - 进程输出的错误数据
 */
daemonProcess.stderr?.on('data', (data) => {
  const message = `[Daemon ERROR] ${data.toString().trim()}`;
  logError(message);
});

// ==================== 信号处理和进程关闭 ====================

/**
 * 关闭所有子进程并退出主进程
 * 收到系统信号时，向两个子进程转发相同的信号
 * @param {NodeJS.Signals} signal - 系统信号类型（如 SIGINT、SIGTERM、SIGHUP）
 * @returns {void}
 */
function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log(`收到信号 ${signal}，正在关闭所有进程...`);

  // 向子进程发送相同的信号
  try {
    if (webProcess && !webProcess.killed) {
      log(`向 Web 进程发送 ${signal} 信号`);
      webProcess.kill(signal);
    }
  } catch (err) {
    logError(`关闭 Web 进程失败: ${err.message}`);
  }

  try {
    if (daemonProcess && !daemonProcess.killed) {
      log(`向 Daemon 进程发送 ${signal} 信号`);
      daemonProcess.kill(signal);
    }
  } catch (err) {
    logError(`关闭 Daemon 进程失败: ${err.message}`);
  }

  // 等待一段时间后强制退出
  setTimeout(() => {
    log('强制退出主进程');
    logStream.end();
    exit(0);
  }, 5000);
}

/**
 * 监听系统终止信号并执行优雅关闭
 * - SIGINT: 通常由 Ctrl+C 触发
 * - SIGTERM: 系统请求终止进程
 * - SIGHUP: 终端挂起信号
 */
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGHUP', () => shutdown('SIGHUP'));

// ==================== 进程退出监听 ====================

/**
 * 监听 Web 进程退出事件
 * 如果不是正常关闭，则关闭 Daemon 进程并退出主进程
 * @param {number | null} code - 进程退出码
 * @param {NodeJS.Signals | null} signal - 导致进程退出的信号
 */
webProcess.on('exit', (code, signal) => {
  if (isShuttingDown) {
    log(`Web 端进程已退出，退出码：${code}，信号：${signal}`);
    return;
  }

  logError(`Web 端进程异常退出！退出码：${code}，信号：${signal}`);
  logError('检测到 Web 进程退出，正在关闭 Daemon 进程...');

  // 关闭另一个进程
  try {
    if (daemonProcess && !daemonProcess.killed) {
      daemonProcess.kill('SIGTERM');
    }
  } catch (err) {
    logError(`关闭 Daemon 进程失败: ${err.message}`);
  }

  // 等待日志写入后退出
  setTimeout(() => {
    logStream.end();
    exit(1);
  }, 1000);
});

/**
 * 监听 Daemon 进程退出事件
 * 如果不是正常关闭，则关闭 Web 进程并退出主进程
 * @param {number | null} code - 进程退出码
 * @param {NodeJS.Signals | null} signal - 导致进程退出的信号
 */
daemonProcess.on('exit', (code, signal) => {
  if (isShuttingDown) {
    log(`Daemon 端进程已退出，退出码：${code}，信号：${signal}`);
    return;
  }

  logError(`Daemon 端进程异常退出！退出码：${code}，信号：${signal}`);
  logError('检测到 Daemon 进程退出，正在关闭 Web 进程...');

  // 关闭另一个进程
  try {
    if (webProcess && !webProcess.killed) {
      webProcess.kill('SIGTERM');
    }
  } catch (err) {
    logError(`关闭 Web 进程失败: ${err.message}`);
  }

  // 等待日志写入后退出
  setTimeout(() => {
    logStream.end();
    exit(1);
  }, 1000);
});

// ==================== 进程错误监听 ====================

/**
 * 监听 Web 进程错误事件
 * 例如：进程启动失败、无法执行命令等
 * @param {Error} err - 错误对象
 */
webProcess.on('error', (err) => {
  logError(`Web 进程错误: ${err.message}`);
});

/**
 * 监听 Daemon 进程错误事件
 * 例如：进程启动失败、无法执行命令等
 * @param {Error} err - 错误对象
 */
daemonProcess.on('error', (err) => {
  logError(`Daemon 进程错误: ${err.message}`);
});

// ==================== 主进程退出处理 ====================

/**
 * 监听主进程退出事件，确保日志流正确关闭
 * @param {number} code - 主进程退出码
 */
process.on('exit', (code) => {
  log(`主进程退出，退出码：${code}`);
  logStream.end();
});