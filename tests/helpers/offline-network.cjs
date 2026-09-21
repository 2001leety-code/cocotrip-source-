'use strict';

const net = require('node:net');
const tls = require('node:tls');
const dns = require('node:dns');
const dgram = require('node:dgram');
const { syncBuiltinESMExports } = require('node:module');

const BLOCKED_CODE = 'OFFLINE_NETWORK_BLOCKED';
const LOOPBACK_HOSTS = new Set(['localhost', 'localhost.', 'ip6-localhost']);

function isLoopbackHost(value) {
  if (value === undefined || value === null || value === '') return true;
  const host = String(value).trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (LOOPBACK_HOSTS.has(host)) return true;
  if (net.isIP(host) === 4 && host.startsWith('127.')) return true;
  if (net.isIP(host) === 6 && (host === '::1' || host.startsWith('::ffff:127.'))) return true;
  return false;
}

function blockedError() {
  const error = new Error('offline-preload: external network access blocked');
  error.code = BLOCKED_CODE;
  return error;
}

function assertLoopback(host) {
  if (!isLoopbackHost(host)) throw blockedError();
}

function connectionHost(args) {
  const first = args[0];
  const second = args[1];
  if (Array.isArray(first)) return connectionHost(first);
  if (typeof first === 'number') return typeof second === 'string' ? second : undefined;
  if (typeof first === 'string') {
    if (/^\d+$/.test(first)) return typeof second === 'string' ? second : undefined;
    if (first.startsWith('\\\\') && !first.startsWith('\\\\.\\pipe\\')) throw blockedError();
    return undefined;
  }
  if (first && typeof first === 'object') {
    if (first.path) return connectionHost([first.path]);
    return first.host || first.hostname;
  }
  return undefined;
}

function guardConnectionArgs(args) {
  assertLoopback(connectionHost(args));
}

const originalSocketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function offlineSocketConnect(...args) {
  guardConnectionArgs(args);
  return originalSocketConnect.apply(this, args);
};

const originalNetConnect = net.connect;
net.connect = function offlineNetConnect(...args) {
  guardConnectionArgs(args);
  return originalNetConnect.apply(this, args);
};
net.createConnection = net.connect;

if (typeof tls.connect === 'function') {
  const originalTlsConnect = tls.connect;
  tls.connect = function offlineTlsConnect(...args) {
    guardConnectionArgs(args);
    return originalTlsConnect.apply(this, args);
  };
}

function guardDnsHost(host) {
  assertLoopback(host);
}

for (const method of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse']) {
  if (typeof dns[method] !== 'function') continue;
  const original = dns[method];
  dns[method] = function offlineDnsGuard(host, ...args) {
    if (method !== 'lookup') throw blockedError();
    guardDnsHost(host);
    if (LOOPBACK_HOSTS.has(String(host).toLowerCase())) host = '127.0.0.1';
    return original.call(this, host, ...args);
  };
}

if (dns.promises) {
  for (const method of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse']) {
    if (typeof dns.promises[method] !== 'function') continue;
    const original = dns.promises[method];
    dns.promises[method] = async function offlineDnsPromisesGuard(host, ...args) {
      if (method !== 'lookup') throw blockedError();
      guardDnsHost(host);
      if (LOOPBACK_HOSTS.has(String(host).toLowerCase())) host = '127.0.0.1';
      return original.call(this, host, ...args);
    };
  }
}

for (const Resolver of [dns.Resolver, dns.promises.Resolver]) {
  for (const method of Object.getOwnPropertyNames(Resolver.prototype)) {
    if (method.startsWith('resolve') || method === 'reverse') {
      Resolver.prototype[method] = () => { throw blockedError(); };
    }
  }
}
dgram.Socket.prototype.connect = dgram.Socket.prototype.send = () => { throw blockedError(); };
dns.lookupService = dns.promises.lookupService = () => { throw blockedError(); };
syncBuiltinESMExports();

module.exports = { BLOCKED_CODE, isLoopbackHost };
