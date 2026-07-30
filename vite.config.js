import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: './',
  // Flag di vue-i18n, dichiarati qui perché altrimenti restano nel bundle come
  // rami vivi. FULL_INSTALL deve restare true: è quello che registra <i18n-t>,
  // usato in LibrarySidebar. Le API legacy no, si usa solo la Composition API.
  define: {
    __VUE_I18N_FULL_INSTALL__: 'true',
    __VUE_I18N_LEGACY_API__: 'false',
    __INTLIFY_PROD_DEVTOOLS__: 'false',
    __INTLIFY_DROP_MESSAGE_COMPILER__: 'false'
  },
  build: { outDir: 'dist/renderer' }
})
