import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.catclimber.game',
  appName: 'Cat Climber',
  webDir: 'dist',
  android: {
    backgroundColor: '#042f2e',
  },
  server: {
    androidScheme: 'https',
    cleartext: true,
  },
};

export default config;
