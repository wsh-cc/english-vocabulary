import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.wordweave.offline', appName: '词间', webDir: 'dist', backgroundColor: '#f6f7f4',
  android: {backgroundColor: '#f6f7f4', allowMixedContent: false},
  // One inset owner: old WebViews use native padding + zero CSS insets;
  // newer WebViews draw edge-to-edge and provide live four-sided CSS insets.
  plugins: {SystemBars: {insetsHandling: 'css', initialViewportFitValueHint: 'cover'}},
};
export default config;
