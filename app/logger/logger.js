function timestamp() {
    return new Date().toLocaleTimeString('ro-RO');
}

function info(message) {
    console.log(`[${timestamp()}] ℹ️  ${message}`);
}

function success(message) {
    console.log(`[${timestamp()}] ✅ ${message}`);
}

function warning(message) {
    console.log(`[${timestamp()}] ⚠️ ${message}`);
}

function error(message) {
    console.log(`[${timestamp()}] ❌ ${message}`);
}

module.exports = {
    info,
    success,
    warning,
    error
};