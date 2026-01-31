import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './styles/globals.css'
import './i18n'
import { cleanupLargeData, migrateFromLocalStorage, migrateIndexedDBKeys } from './lib/indexed-db'

// Hide splash screen when React is ready
const hideSplash = () => {
    const splash = document.getElementById('splash-screen')
    if (splash) {
        splash.classList.add('fade-out')
        setTimeout(() => splash.remove(), 500)
    }
}

// Start app only after migrations complete
async function startApp() {
    // CRITICAL: Migration must complete BEFORE React renders
    // Otherwise Zustand stores will hydrate from empty IndexedDB
    
    // Step 1: Migrate renamed keys within IndexedDB (old name → new name)
    // This handles stores that were already using IndexedDB but had their names changed
    await migrateIndexedDBKeys([
        ['nais-library-storage', 'nais2-library'],  // Library items (was already IndexedDB)
        ['tools-storage', 'nais2-tools'],           // Tools settings
        ['nais-update', 'nais2-update'],            // Update state
    ])
    console.log('[Startup] IndexedDB key migration complete')

    // Step 2: Migrate localStorage to IndexedDB for ALL stores
    // Missing entries here will cause data loss on app restart/update!
    await migrateFromLocalStorage([
        'nais2-generation',        // Main mode prompts & settings (CRITICAL!)
        'nais2-character-store',   // Character/Vibe images
        'nais2-character-prompts', // Character prompt presets
        'nais2-presets',           // Generation presets
        'nais2-settings',          // App settings
        'nais2-auth',              // Auth tokens
        'nais2-scenes',            // Scene mode data
        'nais2-shortcuts',         // Keyboard shortcuts
        'nais2-theme',             // Theme settings
        'nais2-wildcards',         // Wildcard/Fragment data
        'nais2-layout',            // Layout preferences
        'nais2-library',           // Library items
        'nais2-tools',             // Tools settings (brush size, etc.)
        'nais2-update',            // Update state
    ])
    console.log('[Startup] LocalStorage migration complete')

    // Cleanup large wildcard data (non-critical, can be async)
    cleanupLargeData('nais2-wildcards', 100).then((cleaned) => {
        if (cleaned) {
            console.log('[Startup] Large wildcard data was cleaned up')
        }
    })

    // NOW render React app
    ReactDOM.createRoot(document.getElementById('root')!).render(
        <React.StrictMode>
            <App />
        </React.StrictMode>,
    )

    // Delay slightly to ensure app renders, then hide splash
    requestAnimationFrame(() => {
        requestAnimationFrame(hideSplash)
    })
}

startApp()

// Delay slightly to ensure app renders, then hide splash
requestAnimationFrame(() => {
    requestAnimationFrame(hideSplash)
})
