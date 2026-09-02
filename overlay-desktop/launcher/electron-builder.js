module.exports = {
  appId: 'com.rxai.studio.launcher',
  productName: 'RX AI Studio Launcher',
  directories: {
    output: 'launcher/dist',
  },
  extraMetadata: {
    name: 'rx-ai-studio-launcher',
    productName: 'RX AI Studio Launcher',
    version: '0.1.0',
    main: 'launcher/main.js',
  },
  files: [
    'launcher/main.js',
    'launcher/update-client.js',
    'launcher/preload.js',
    'launcher/renderer/**/*',
    'build/icon.png',
  ],
  win: {
    icon: 'build/icon.ico',
    signAndEditExecutable: false,
    target: [
      {
        target: 'portable',
        arch: ['x64'],
      },
    ],
    artifactName: 'RX-AI-Studio-Launcher-${version}.${ext}',
  },
};
