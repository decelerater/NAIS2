import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/components/ui/use-toast'
import { useSceneStore } from '@/stores/scene-store'
import { useGenerationStore } from '@/stores/generation-store'
import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useAuthStore } from '@/stores/auth-store'
import { generateImage, generateImageStream, GenerationParams } from '@/services/novelai-api'
import { BaseDirectory, writeFile, mkdir, exists } from '@tauri-apps/plugin-fs'
import { pictureDir, join } from '@tauri-apps/api/path'
import { processWildcards } from '@/lib/fragment-processor'
import { createThumbnail } from '@/lib/image-utils'
import { useCharacterStore } from '@/stores/character-store'

// Module-level variable to prevent concurrent processing
let isProcessing = false

export function useSceneGeneration() {
    const { t } = useTranslation()
    const { token } = useAuthStore()
    const { savePath, useStreaming: streamingView } = useSettingsStore()

    const {
        isGenerating,
        setIsGenerating,
        activePresetId,
        decrementFirstQueuedScene,
        addImageToScene,
        setStreamingData,
        initGenerationProgress,
        setGenerationProgress,
        completedCount,
        totalQueuedCount,
        generationSessionId
    } = useSceneStore()

    useEffect(() => {
        const processQueue = async (sessionId: number) => {
            if (isProcessing) {
                return
            }
            
            if (sessionId !== useSceneStore.getState().generationSessionId) {
                isProcessing = false
                return
            }
            
            isProcessing = true

            const sceneState = useSceneStore.getState()
            if (sceneState.isCancelling || !isGenerating) {
                if (useGenerationStore.getState().generatingMode === 'scene') {
                    useGenerationStore.getState().setGeneratingMode(null)
                }
                setIsGenerating(false)
                isProcessing = false
                return
            }

            if (useGenerationStore.getState().generatingMode === 'main') {
                setIsGenerating(false)
                isProcessing = false
                toast({
                    title: t('common.error', '오류'),
                    description: t('generate.conflictMain', '메인 모드에서 생성 중입니다.'),
                    variant: 'destructive'
                })
                return
            }

            if (useGenerationStore.getState().generatingMode !== 'scene') {
                useGenerationStore.getState().setGeneratingMode('scene')
            }

            if (!activePresetId || !token) {
                setIsGenerating(false)
                isProcessing = false
                return
            }

            if (sessionId !== useSceneStore.getState().generationSessionId) {
                isProcessing = false
                return
            }

            const scene = decrementFirstQueuedScene(activePresetId)

            if (!scene) {
                setIsGenerating(false)
                useGenerationStore.getState().setGeneratingMode(null)
                setGenerationProgress(0, 0)
                isProcessing = false
                useCharacterStore.getState().releaseImageData()
                toast({ title: t('generate.complete', '생성 완료'), description: t('generate.allComplete', '모든 예약된 작업이 완료되었습니다.'), variant: 'success' })
                return
            }

            setStreamingData(scene.id, null, 0)

            try {
                const genState = useGenerationStore.getState()

                const removeComments = (text: string) => text
                    .split('\n')
                    .filter(line => !line.trimStart().startsWith('#'))
                    .join('\n')

                const parts = [
                    removeComments(genState.basePrompt),
                    genState.i2iMode === 'inpaint' ? removeComments(genState.inpaintingPrompt) : null,
                    removeComments(genState.additionalPrompt),
                    removeComments(scene.scenePrompt),
                    removeComments(genState.detailPrompt),
                ].filter(p => p && p.trim())

                const finalPrompt = await processWildcards(parts.join(', '))

                await useCharacterStore.getState().ensureImagesLoaded()
                const latestCharStore = useCharacterStore.getState()
                const characterImages = latestCharStore.characterImages.filter(img => img.enabled !== false && img.base64)
                const vibeImages = latestCharStore.vibeImages.filter(img => img.enabled !== false && img.base64)
                const { characters: characterPrompts } = useCharacterPromptStore.getState()

                const processedCharacterPrompts = await Promise.all(
                    characterPrompts.filter(c => c.enabled).map(async c => ({
                        prompt: await processWildcards(c.prompt),
                        negative: await processWildcards(c.negative),
                        enabled: c.enabled,
                        position: c.position
                    }))
                )

                let finalSeed = genState.seedLocked ? genState.seed : Math.floor(Math.random() * 4294967295)
                if (finalSeed === 0) {
                    finalSeed = Math.floor(Math.random() * 4294967295)
                }

                const roundTo64 = (value: number): number => Math.round(value / 64) * 64

                let finalWidth = roundTo64(scene.width || genState.selectedResolution.width)
                let finalHeight = roundTo64(scene.height || genState.selectedResolution.height)

                if (genState.sourceImage) {
                    try {
                        const img = new Image()
                        await new Promise<void>((resolve, reject) => {
                            img.onload = () => resolve()
                            img.onerror = () => reject(new Error('Failed to load source image'))
                            img.src = genState.sourceImage!
                        })
                        finalWidth = roundTo64(img.width)
                        finalHeight = roundTo64(img.height)
                        img.src = ''
                    } catch (e) {
                        console.warn('[SceneGeneration] Failed to get source image dimensions, using scene/global resolution')
                    }
                }

                // 🔥 오토 퀄리티 태그 & UC Preset 적용 수정 완료 🔥
                const params: GenerationParams = {
                    prompt: finalPrompt,
                    negative_prompt: removeComments(genState.negativePrompt),
                    steps: genState.steps,
                    cfg_scale: genState.cfgScale,
                    cfg_rescale: genState.cfgRescale,
                    sampler: genState.sampler,
                    scheduler: genState.scheduler,
                    smea: genState.smea,
                    smea_dyn: genState.smeaDyn,
                    variety: genState.variety ?? false,
                    seed: finalSeed,
                    width: finalWidth,
                    height: finalHeight,
                    model: genState.model,
                    sourceImage: genState.sourceImage || undefined,
                    strength: genState.strength,
                    noise: genState.noise,
                    mask: genState.mask || undefined,
                    charImages: characterImages.filter(img => img.base64).map(img => img.base64!),
                    charStrength: characterImages.filter(img => img.base64).map(img => img.strength),
                    charFidelity: characterImages.filter(img => img.base64).map(img => img.fidelity ?? 0.6),
                    charReferenceType: characterImages.filter(img => img.base64).map(img => img.referenceType ?? 'character&style'),
                    charCacheKeys: characterImages.filter(img => img.base64).map(img => img.cacheKey || null),
                    vibeImages: vibeImages.filter(img => img.base64).map(img => img.base64!),
                    vibeInfo: vibeImages.filter(img => img.base64).map(img => img.informationExtracted),
                    vibeStrength: vibeImages.filter(img => img.base64).map(img => img.strength),
                    preEncodedVibes: vibeImages.filter(img => img.base64).map(img => img.encodedVibe || null),
                    characterPrompts: processedCharacterPrompts,
                    imageFormat: useSettingsStore.getState().imageFormat,
                    qualityToggle: genState.qualityToggle,
                    ucPreset: genState.ucPreset,
                }

                let result

                const streamMimeType = params.imageFormat === 'webp' ? 'image/webp' : 'image/png'
                if (streamingView) {
                    result = await generateImageStream(token, params, (progress, image) => {
                        if (image) {
                            setStreamingData(scene.id, `data:${streamMimeType};base64,${image}`, progress / 100)
                        } else {
                            setStreamingData(scene.id, null, progress / 100)
                        }
                    })
                } else {
                    result = await generateImage(token, params)
                }

                if (result.success && result.imageData) {
                    const currentPreset = useSceneStore.getState().presets.find(p => p.id === activePresetId)
                    const safePresetName = (currentPreset?.name || 'Default').replace(/[<>:"/\\|?*]/g, '_').trim()
                    const safeSceneName = scene.name.replace(/[<>:"/\\|?*]/g, '_').trim() || 'Untitled_Scene'
                    
                    // 🔥 파일명 커스텀 템플릿 적용 완료 🔥
                    const { imageFormat, useCharacterFolderStructure, sceneFileNameTemplate } = useSettingsStore.getState()
                    const fileExt = imageFormat === 'webp' ? 'webp' : 'png'
                    const mimeType = imageFormat === 'webp' ? 'image/webp' : 'image/png'
                    
                    const template = sceneFileNameTemplate || '{preset}_{scene}_{timestamp}'
                    const now = new Date()
                    const fileName = template
                        .replace('{preset}', safePresetName)
                        .replace('{scene}', safeSceneName)
                        .replace('{timestamp}', Date.now().toString())
                        .replace('{date}', now.toISOString().slice(0,10).replace(/-/g,''))
                        .replace('{seed}', String(params.seed))
                        + `.${fileExt}`

                    try {
                        const base64Data = result.imageData.replace(/^data:image\/(png|webp);base64,/, '')
                        const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0))

                        const { useAbsolutePath } = useSettingsStore.getState()
                        let fullPath: string

                        // 🔥 캐릭터 폴더 구조 적용 완료 🔥
                        if (useAbsolutePath && savePath) {
                            let sceneDir: string;

                            if (useCharacterFolderStructure) {
                                // 구조: 저장경로 / 캐릭터명 / 씬명
                                const presetDir = await join(savePath, safePresetName)
                                sceneDir = await join(presetDir, safeSceneName)
                                
                                if (!(await exists(presetDir))) await mkdir(presetDir, { recursive: true })
                                if (!(await exists(sceneDir))) await mkdir(sceneDir, { recursive: true })
                            } else {
                                // 기존 구조: 저장경로 / NAIS_Scene / 캐릭터명 / 씬명
                                const naisSceneDir = await join(savePath, 'NAIS_Scene')
                                const presetDir = await join(naisSceneDir, safePresetName)
                                sceneDir = await join(presetDir, safeSceneName)
                                
                                if (!(await exists(naisSceneDir))) await mkdir(naisSceneDir, { recursive: true })
                                if (!(await exists(presetDir))) await mkdir(presetDir, { recursive: true })
                                if (!(await exists(sceneDir))) await mkdir(sceneDir, { recursive: true })
                            }

                            fullPath = await join(sceneDir, fileName)
                            await writeFile(fullPath, binaryData)
                        } else {
                            const baseDir = await pictureDir()
                            let presetSceneDir: string;

                            if (useCharacterFolderStructure) {
                                presetSceneDir = `${safePresetName}/${safeSceneName}`
                                
                                if (!(await exists(safePresetName, { baseDir: BaseDirectory.Picture }))) {
                                    await mkdir(safePresetName, { baseDir: BaseDirectory.Picture })
                                }
                                if (!(await exists(presetSceneDir, { baseDir: BaseDirectory.Picture }))) {
                                    await mkdir(presetSceneDir, { baseDir: BaseDirectory.Picture })
                                }
                            } else {
                                presetSceneDir = `NAIS_Scene/${safePresetName}/${safeSceneName}`
                                const naisSceneDir = 'NAIS_Scene'
                                const presetDirPath = `NAIS_Scene/${safePresetName}`

                                if (!(await exists(naisSceneDir, { baseDir: BaseDirectory.Picture }))) {
                                    await mkdir(naisSceneDir, { baseDir: BaseDirectory.Picture })
                                }
                                if (!(await exists(presetDirPath, { baseDir: BaseDirectory.Picture }))) {
                                    await mkdir(presetDirPath, { baseDir: BaseDirectory.Picture })
                                }
                                if (!(await exists(presetSceneDir, { baseDir: BaseDirectory.Picture }))) {
                                    await mkdir(presetSceneDir, { baseDir: BaseDirectory.Picture })
                                }
                            }

                            await writeFile(`${presetSceneDir}/${fileName}`, binaryData, { baseDir: BaseDirectory.Picture })
                            fullPath = await join(baseDir, presetSceneDir, fileName)
                        }

                        window.dispatchEvent(new CustomEvent('newImageGenerated', {
                            detail: { path: fullPath }
                        }))

                        addImageToScene(activePresetId, scene.id, fullPath)

                        const thumbnailData = result.imageData 
                            ? await createThumbnail(`data:${mimeType};base64,${result.imageData}`)
                            : undefined
                        useGenerationStore.getState().addToHistory({
                            id: Date.now().toString(),
                            url: fullPath,
                            thumbnail: thumbnailData,
                            prompt: finalPrompt,
                            seed: params.seed,
                            timestamp: new Date()
                        })

                        if (result.encodedVibes && result.encodedVibes.length > 0) {
                            const { vibeImages, updateVibeImage } = useCharacterStore.getState()
                            let encodedIndex = 0
                            for (let vi = 0; vi < vibeImages.length && encodedIndex < result.encodedVibes.length; vi++) {
                                if (!vibeImages[vi].encodedVibe) {
                                    updateVibeImage(vibeImages[vi].id, { encodedVibe: result.encodedVibes[encodedIndex] })
                                    encodedIndex++
                                }
                            }
                        }

                    } catch (saveError) {
                        console.error('Failed to save scene image file:', saveError)
                        toast({ title: t('common.saveFailed', '파일 저장 실패'), description: String(saveError), variant: 'destructive' })
                    }

                    useAuthStore.getState().refreshAnlas()

                    const currentState = useSceneStore.getState()
                    setGenerationProgress(currentState.completedCount + 1, currentState.totalQueuedCount)

                } else {
                    console.error('Generation failed:', result.error)
                    toast({ title: t('common.error', '오류'), description: result.error || 'Generation failed', variant: 'destructive' })
                }

                setStreamingData(null, null, 0)

                const sceneState = useSceneStore.getState()
                const sessionStillValid = sessionId === sceneState.generationSessionId
                const hasMoreScenes = sessionStillValid && 
                    sceneState.isGenerating &&
                    sceneState.getQueuedScenes(activePresetId).length > 0

                if (hasMoreScenes) {
                    const { generationDelay } = useSettingsStore.getState()
                    if (generationDelay > 0) {
                        await new Promise(resolve => setTimeout(resolve, generationDelay))
                    }
                }

                isProcessing = false

                const latestState = useSceneStore.getState()
                if (latestState.isGenerating && sessionId === latestState.generationSessionId) {
                    processQueue(sessionId)
                }

            } catch (e) {
                console.error('Process queue error:', e)
                isProcessing = false
                setStreamingData(null, null, 0)

                const latestState = useSceneStore.getState()
                if (sessionId !== latestState.generationSessionId) {
                    return
                }

                const errorMessage = String(e)
                if (errorMessage.includes('429') || errorMessage.toLowerCase().includes('too many requests')) {
                    console.log('429 error detected, retrying after 3 seconds...')
                    await new Promise(resolve => setTimeout(resolve, 3000))
                    const retryState = useSceneStore.getState()
                    if (retryState.isGenerating && sessionId === retryState.generationSessionId) {
                        processQueue(sessionId)
                    }
                } else {
                    toast({ title: t('common.error', '오류'), description: errorMessage, variant: 'destructive' })
                    setIsGenerating(false)
                }
            }
        }

        if (isGenerating && !isProcessing) {
            if (completedCount === 0 && totalQueuedCount === 0) {
                initGenerationProgress()
            }
            processQueue(generationSessionId)
        }
    }, [isGenerating, activePresetId, token, savePath, t, addImageToScene, decrementFirstQueuedScene, setIsGenerating, streamingView, setStreamingData, initGenerationProgress, setGenerationProgress, completedCount, totalQueuedCount, generationSessionId])

    useEffect(() => {
        if (!isGenerating) {
            isProcessing = false
        }
    }, [isGenerating])

    return {
        isGenerating
    }
}