import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// 참조 레퍼런스 타입 (NovelAI 2026년 2월 업데이트)
export type PreciseReferenceType = 'character' | 'style' | 'character&style'

export interface ReferenceImage {
    id: string
    filePath?: string  // File path for persistent storage (memory-efficient)
    base64?: string    // Runtime only - loaded from filePath on demand
    enabled: boolean // 활성화/비활성화 (새로 추가)
    encodedVibe?: string  // Pre-encoded vibe data from PNG metadata (skips /ai/encode-vibe API)
    informationExtracted: number // 0 to 1 (Vibe Transfer용)
    strength: number // 0 to 1 - 참조 레퍼런스의 Strength
    fidelity: number // 0 to 1 - 참조 레퍼런스의 Fidelity
    referenceType: PreciseReferenceType // 참조 타입 (character/style/character&style)
    cacheKey?: string // 서버 캐시 키 (이미지 재전송 방지)
}

interface CharacterState {
    characterImages: ReferenceImage[]
    vibeImages: ReferenceImage[]
    isHydrated: boolean  // Track if images have been loaded from files

    // Actions
    addCharacterImage: (base64: string) => Promise<void>
    updateCharacterImage: (id: string, updates: Partial<ReferenceImage>) => void
    removeCharacterImage: (id: string) => void

    addVibeImage: (base64: string, encodedVibe?: string, informationExtracted?: number, strength?: number) => Promise<void>
    updateVibeImage: (id: string, updates: Partial<ReferenceImage>) => void
    removeVibeImage: (id: string) => void

    clearAll: () => void
    
    // Memory management
    loadImagesFromFiles: () => Promise<void>  // Load base64 from files on startup
    clearRuntimeData: () => void  // Clear base64 from memory (keep filePaths)
}

import { createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'
import { saveReferenceImage, loadReferenceImage, deleteReferenceImage } from '@/lib/image-utils'

// MEMORY OPTIMIZATION: Limit reference images to prevent OOM
const MAX_CHARACTER_IMAGES = 10
const MAX_VIBE_IMAGES = 10

export const useCharacterStore = create<CharacterState>()(
    persist(
        (set, get) => ({
            characterImages: [],
            vibeImages: [],
            isHydrated: false,

            addCharacterImage: async (base64) => {
                const id = Date.now().toString()
                
                // Save to file first
                let filePath: string | undefined
                try {
                    filePath = await saveReferenceImage(base64, id, 'character')
                } catch (e) {
                    console.error('[CharacterStore] Failed to save character image to file:', e)
                    // Continue with base64 only (will work but won't persist efficiently)
                }
                
                set((state) => {
                    const newImages = [
                        ...state.characterImages,
                        {
                            id,
                            filePath,
                            base64,  // Keep in memory for immediate use
                            enabled: true,
                            informationExtracted: 1.0,
                            strength: 0.6,
                            fidelity: 0.6,
                            referenceType: 'character&style' as PreciseReferenceType
                        }
                    ]
                    
                    // Limit total count - remove oldest when over limit
                    if (newImages.length > MAX_CHARACTER_IMAGES) {
                        const toRemove = newImages.slice(0, newImages.length - MAX_CHARACTER_IMAGES)
                        // Delete old files asynchronously
                        toRemove.forEach(img => {
                            if (img.filePath) deleteReferenceImage(img.filePath)
                        })
                        console.warn(`[CharacterStore] Trimming character images from ${newImages.length} to ${MAX_CHARACTER_IMAGES}`)
                        return { characterImages: newImages.slice(-MAX_CHARACTER_IMAGES) }
                    }
                    
                    return { characterImages: newImages }
                })
            },

            updateCharacterImage: (id, updates) => set((state) => ({
                characterImages: state.characterImages.map(img =>
                    img.id === id ? { ...img, ...updates } : img
                )
            })),

            removeCharacterImage: (id) => {
                const state = get()
                const img = state.characterImages.find(i => i.id === id)
                if (img?.filePath) {
                    deleteReferenceImage(img.filePath)
                }
                set((state) => ({
                    characterImages: state.characterImages.filter(img => img.id !== id)
                }))
            },

            addVibeImage: async (base64, encodedVibe, informationExtracted, strength) => {
                console.log('[CharacterStore] addVibeImage called', { encodedVibe: !!encodedVibe })
                const id = Date.now().toString()
                
                // Save to file first
                let filePath: string | undefined
                try {
                    filePath = await saveReferenceImage(base64, id, 'vibe')
                } catch (e) {
                    console.error('[CharacterStore] Failed to save vibe image to file:', e)
                }
                
                set((state) => {
                    const newImages = [
                        ...state.vibeImages,
                        {
                            id,
                            filePath,
                            base64,  // Keep in memory for immediate use
                            enabled: true,
                            encodedVibe,
                            informationExtracted: informationExtracted ?? 1.0,
                            strength: strength ?? 0.6,
                            fidelity: 0.6,
                            referenceType: 'character&style' as PreciseReferenceType
                        }
                    ]
                    
                    // Limit total count - remove oldest when over limit
                    if (newImages.length > MAX_VIBE_IMAGES) {
                        const toRemove = newImages.slice(0, newImages.length - MAX_VIBE_IMAGES)
                        toRemove.forEach(img => {
                            if (img.filePath) deleteReferenceImage(img.filePath)
                        })
                        console.warn(`[CharacterStore] Trimming vibe images from ${newImages.length} to ${MAX_VIBE_IMAGES}`)
                        return { vibeImages: newImages.slice(-MAX_VIBE_IMAGES) }
                    }
                    
                    return { vibeImages: newImages }
                })
            },

            updateVibeImage: (id, updates) => set((state) => ({
                vibeImages: state.vibeImages.map(img =>
                    img.id === id ? { ...img, ...updates } : img
                )
            })),

            removeVibeImage: (id) => {
                const state = get()
                const img = state.vibeImages.find(i => i.id === id)
                if (img?.filePath) {
                    deleteReferenceImage(img.filePath)
                }
                set((state) => ({
                    vibeImages: state.vibeImages.filter(img => img.id !== id)
                }))
            },

            clearAll: () => {
                const state = get()
                // Delete all files
                state.characterImages.forEach(img => {
                    if (img.filePath) deleteReferenceImage(img.filePath)
                })
                state.vibeImages.forEach(img => {
                    if (img.filePath) deleteReferenceImage(img.filePath)
                })
                set({ characterImages: [], vibeImages: [] })
            },
            
            // Load base64 data from files for images that only have filePath
            // Also handles migration: if base64 exists but no filePath, save to file
            loadImagesFromFiles: async () => {
                const state = get()
                console.log('[CharacterStore] Loading images from files...')
                let needsSave = false
                
                // Load/migrate character images
                const loadedCharImages = await Promise.all(
                    state.characterImages.map(async (img) => {
                        // Case 1: Has base64, no filePath - MIGRATION needed
                        if (img.base64 && !img.filePath) {
                            console.log(`[CharacterStore] Migrating character image ${img.id} to file...`)
                            try {
                                const filePath = await saveReferenceImage(img.base64, img.id, 'character')
                                needsSave = true
                                return { ...img, filePath }
                            } catch (e) {
                                console.error(`[CharacterStore] Failed to migrate character image ${img.id}:`, e)
                                return img  // Keep as-is with base64
                            }
                        }
                        
                        // Case 2: Already in memory
                        if (img.base64) return img
                        
                        // Case 3: Has filePath, load from file
                        if (img.filePath) {
                            const base64 = await loadReferenceImage(img.filePath)
                            if (base64) {
                                return { ...img, base64 }
                            }
                            // File missing - mark for removal
                            console.warn(`[CharacterStore] Character image file missing: ${img.filePath}`)
                            return null
                        }
                        
                        return img  // No source available
                    })
                )
                
                // Load/migrate vibe images
                const loadedVibeImages = await Promise.all(
                    state.vibeImages.map(async (img) => {
                        // Case 1: Has base64, no filePath - MIGRATION needed
                        if (img.base64 && !img.filePath) {
                            console.log(`[CharacterStore] Migrating vibe image ${img.id} to file...`)
                            try {
                                const filePath = await saveReferenceImage(img.base64, img.id, 'vibe')
                                needsSave = true
                                return { ...img, filePath }
                            } catch (e) {
                                console.error(`[CharacterStore] Failed to migrate vibe image ${img.id}:`, e)
                                return img  // Keep as-is with base64
                            }
                        }
                        
                        // Case 2: Already in memory
                        if (img.base64) return img
                        
                        // Case 3: Has filePath, load from file
                        if (img.filePath) {
                            const base64 = await loadReferenceImage(img.filePath)
                            if (base64) {
                                return { ...img, base64 }
                            }
                            console.warn(`[CharacterStore] Vibe image file missing: ${img.filePath}`)
                            return null
                        }
                        
                        return img  // No source available
                    })
                )
                
                const validCharImages = loadedCharImages.filter((img): img is ReferenceImage => img !== null)
                const validVibeImages = loadedVibeImages.filter((img): img is ReferenceImage => img !== null)
                
                set({
                    characterImages: validCharImages,
                    vibeImages: validVibeImages,
                    isHydrated: true
                })
                
                console.log(`[CharacterStore] Loaded ${validCharImages.length} character images, ${validVibeImages.length} vibe images`)
                
                // If migration happened, trigger a save to persist filePaths
                if (needsSave) {
                    console.log('[CharacterStore] Migration completed - filePaths will be saved on next state change')
                }
            },
            
            // Clear base64 data from memory (for mode switching)
            clearRuntimeData: () => {
                console.log('[CharacterStore] Clearing runtime data (keeping file paths)')
                set((state) => ({
                    characterImages: state.characterImages.map(img => ({ ...img, base64: undefined })),
                    vibeImages: state.vibeImages.map(img => ({ ...img, base64: undefined })),
                    isHydrated: false
                }))
            }
        }),
        {
            name: 'nais2-character-store',
            storage: createJSONStorage(() => indexedDBStorage),
            // MEMORY OPTIMIZATION: Only persist filePath, but keep base64 for legacy migration
            partialize: (state) => ({
                characterImages: state.characterImages.map(img => ({
                    id: img.id,
                    filePath: img.filePath,
                    // Only persist base64 if no filePath (for legacy data migration)
                    // After migration, base64 will be in file, so we don't need to persist it
                    base64: img.filePath ? undefined : img.base64,
                    enabled: img.enabled,
                    encodedVibe: img.encodedVibe,
                    informationExtracted: img.informationExtracted,
                    strength: img.strength,
                    fidelity: img.fidelity,
                    referenceType: img.referenceType,
                    cacheKey: img.cacheKey
                })),
                vibeImages: state.vibeImages.map(img => ({
                    id: img.id,
                    filePath: img.filePath,
                    // Only persist base64 if no filePath (for legacy data migration)
                    base64: img.filePath ? undefined : img.base64,
                    enabled: img.enabled,
                    encodedVibe: img.encodedVibe,
                    informationExtracted: img.informationExtracted,
                    strength: img.strength,
                    fidelity: img.fidelity,
                    referenceType: img.referenceType,
                    cacheKey: img.cacheKey
                }))
            }),
            onRehydrateStorage: () => (state, error) => {
                if (error) {
                    console.error('[CharacterStore] Hydration failed:', error)
                    return
                }
                if (state) {
                    console.log(`[CharacterStore] Hydrated: ${state.characterImages.length} character refs, ${state.vibeImages.length} vibe refs`)
                    // Note: loadImagesFromFiles() should be called after hydration
                    // This will be done in main.tsx or App.tsx
                }
            }
        }
    )
)
