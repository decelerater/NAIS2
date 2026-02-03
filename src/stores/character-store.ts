import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// 참조 레퍼런스 타입 (NovelAI 2026년 2월 업데이트)
export type PreciseReferenceType = 'character' | 'style' | 'character&style'

export interface ReferenceImage {
    id: string
    base64: string
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

    // Actions
    addCharacterImage: (base64: string) => void
    updateCharacterImage: (id: string, updates: Partial<ReferenceImage>) => void
    removeCharacterImage: (id: string) => void

    addVibeImage: (base64: string, encodedVibe?: string, informationExtracted?: number, strength?: number) => void
    updateVibeImage: (id: string, updates: Partial<ReferenceImage>) => void
    removeVibeImage: (id: string) => void

    clearAll: () => void
}

import { createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'

export const useCharacterStore = create<CharacterState>()(
    persist(
        (set) => ({
            characterImages: [],
            vibeImages: [],

            addCharacterImage: (base64) => set((state) => ({
                characterImages: [
                    ...state.characterImages,
                    {
                        id: Date.now().toString(),
                        base64,
                        enabled: true,
                        informationExtracted: 1.0,
                        strength: 0.6,
                        fidelity: 0.6,
                        referenceType: 'character&style' as PreciseReferenceType
                    }
                ]
            })),

            updateCharacterImage: (id, updates) => set((state) => ({
                characterImages: state.characterImages.map(img =>
                    img.id === id ? { ...img, ...updates } : img
                )
            })),

            removeCharacterImage: (id) => set((state) => ({
                characterImages: state.characterImages.filter(img => img.id !== id)
            })),

            addVibeImage: (base64, encodedVibe, informationExtracted, strength) => {
                console.log('[CharacterStore] addVibeImage called', { encodedVibe: !!encodedVibe })
                set((state) => ({
                    vibeImages: [
                        ...state.vibeImages,
                        {
                            id: Date.now().toString(),
                            base64,
                            enabled: true,
                            encodedVibe,
                            informationExtracted: informationExtracted ?? 1.0,
                            strength: strength ?? 0.6,
                            fidelity: 0.6,
                            referenceType: 'character&style' as PreciseReferenceType
                        }
                    ]
                }))
            },

            updateVibeImage: (id, updates) => set((state) => ({
                vibeImages: state.vibeImages.map(img =>
                    img.id === id ? { ...img, ...updates } : img
                )
            })),

            removeVibeImage: (id) => set((state) => ({
                vibeImages: state.vibeImages.filter(img => img.id !== id)
            })),

            clearAll: () => set({ characterImages: [], vibeImages: [] })
        }),
        {
            name: 'nais2-character-store',
            storage: createJSONStorage(() => indexedDBStorage),
            partialize: (state) => ({
                characterImages: state.characterImages,
                vibeImages: state.vibeImages
            })
        }
    )
)
