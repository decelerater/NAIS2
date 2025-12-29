import { useTranslation } from 'react-i18next'
import { useEffect, useState, useRef, useCallback, memo } from 'react'
import { Clock, Trash2, FolderOpen, RefreshCw, FileSearch, Copy, RotateCcw, Save, Users, Image as ImageIcon, Paintbrush, Maximize2, Film } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useGenerationStore } from '@/stores/generation-store'
import { useAuthStore } from '@/stores/auth-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useSceneStore } from '@/stores/scene-store'
import { readDir, readFile, remove, writeFile, mkdir, exists, BaseDirectory } from '@tauri-apps/plugin-fs'
import { pictureDir, join } from '@tauri-apps/api/path'
import { Command } from '@tauri-apps/plugin-shell'
import { save } from '@tauri-apps/plugin-dialog'
import { MetadataDialog } from '@/components/metadata/MetadataDialog'
import { ImageReferenceDialog } from '@/components/metadata/ImageReferenceDialog'
import { parseMetadataFromBase64 } from '@/lib/metadata-parser'
import { generateImage } from '@/services/novelai-api'
import { toast } from '@/components/ui/use-toast'
import { useToolsStore } from '@/stores/tools-store'
import { useLibraryStore } from '@/stores/library-store'
import { useNavigate } from 'react-router-dom'
import { Wand2 } from 'lucide-react'
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
} from '@/components/ui/context-menu'

// Convert ArrayBuffer to base64 without stack overflow
const arrayBufferToBase64 = (buffer: Uint8Array): string => {
    let binary = ''
    const len = buffer.byteLength
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(buffer[i])
    }
    return btoa(binary)
}

interface SavedImage {
    name: string
    path: string
    timestamp: number
    type: 'main' | 'i2i' | 'inpaint' | 'upscale' | 'scene'
}

// Memoized HistoryImageItem - 불필요한 리렌더링 방지
interface HistoryImageItemProps {
    image: SavedImage
    thumbnail?: string
    index: number
    isGenerating: boolean
    getTypeIcon: (type: 'main' | 'i2i' | 'inpaint' | 'upscale' | 'scene') => React.ReactNode
    onImageClick: (image: SavedImage) => void
    onDelete: (image: SavedImage, e?: React.MouseEvent) => void
    onSaveAs: (image: SavedImage) => void
    onCopy: (image: SavedImage) => void
    onRegenerate: (image: SavedImage) => void
    onOpenSmartTools: (image: SavedImage) => void
    onAddAsReference: (image: SavedImage) => void

    onOpenFolder: (image: SavedImage) => void
    onLoadMetadata: (image: SavedImage) => void
    onLoadComplete: (path: string, data: string) => void
}

const HistoryImageItem = memo(function HistoryImageItem({
    image, thumbnail, index, isGenerating, getTypeIcon,
    onImageClick, onDelete, onSaveAs, onCopy, onRegenerate,
    onOpenSmartTools, onAddAsReference, onOpenFolder, onLoadMetadata,
    onLoadComplete
}: HistoryImageItemProps) {
    const { t } = useTranslation()
    const [localThumbnail, setLocalThumbnail] = useState<string | undefined>(thumbnail)

    useEffect(() => {
        if (thumbnail) setLocalThumbnail(thumbnail)
    }, [thumbnail])

    useEffect(() => {
        if (!localThumbnail) {
            let active = true
            const load = async () => {
                try {
                    const data = await readFile(image.path)
                    if (active) {
                        const base64 = arrayBufferToBase64(data)
                        const dataUrl = `data:image/png;base64,${base64}`
                        setLocalThumbnail(dataUrl)
                        onLoadComplete(image.path, dataUrl)
                    }
                } catch (e) {
                    // console.warn('Failed to load image lazily:', image.path)
                }
            }
            load()
            return () => { active = false }
        }
    }, [image.path, localThumbnail, onLoadComplete])

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <div
                    className="aspect-square bg-muted/30 rounded-xl overflow-hidden hover:ring-2 hover:ring-primary hover:scale-[1.02] transition-all shadow-sm relative group cursor-pointer"
                    onClick={() => onImageClick(image)}
                >
                    {localThumbnail ? (
                        <img
                            draggable="true"
                            onDragStart={(e) => {
                                e.dataTransfer.setData('text/plain', image.name);
                                e.dataTransfer.effectAllowed = 'copy';
                                useLibraryStore.getState().setDraggedSource({
                                    name: image.name,
                                    path: image.path
                                });

                                // Create custom drag preview with rounded corners using DOM element
                                const dragPreview = document.createElement('div');
                                dragPreview.style.cssText = `
                                    width: 80px;
                                    height: 80px;
                                    border-radius: 12px;
                                    overflow: hidden;
                                    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
                                    border: 2px solid rgba(255,255,255,0.3);
                                    position: fixed;
                                    top: -200px;
                                    left: -200px;
                                    z-index: 9999;
                                    pointer-events: none;
                                `;

                                const previewImg = document.createElement('img');
                                previewImg.src = localThumbnail || '';
                                previewImg.style.cssText = `
                                    width: 100%;
                                    height: 100%;
                                    object-fit: cover;
                                `;

                                dragPreview.appendChild(previewImg);
                                document.body.appendChild(dragPreview);

                                e.dataTransfer.setDragImage(dragPreview, 40, 40);

                                // Clean up after a short delay
                                setTimeout(() => {
                                    document.body.removeChild(dragPreview);
                                }, 0);
                            }}
                            onDragEnd={() => {
                                useLibraryStore.getState().setDraggedSource(null);
                            }}
                            src={localThumbnail}
                            alt={`Image ${index + 1}`}
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                            Loading...
                        </div>
                    )}
                    <Button
                        variant="destructive"
                        size="icon"
                        className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => onDelete(image, e)}
                    >
                        <Trash2 className="h-3 w-3" />
                    </Button>
                    <div className="absolute bottom-1 left-1 h-5 w-5 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center">
                        {getTypeIcon(image.type)}
                    </div>
                </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
                <ContextMenuItem onClick={() => onSaveAs(image)}>
                    <Save className="h-4 w-4 mr-2" />
                    {t('actions.saveAs', '저장')}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onCopy(image)}>
                    <Copy className="h-4 w-4 mr-2" />
                    {t('actions.copy', '복사')}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onRegenerate(image)} disabled={isGenerating}>
                    <RotateCcw className="h-4 w-4 mr-2" />
                    {t('actions.regenerate', '재생성')}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onOpenSmartTools(image)}>
                    <Wand2 className="h-4 w-4 mr-2" />
                    {t('smartTools.title', '스마트 툴')}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onAddAsReference(image)}>
                    <Users className="h-4 w-4 mr-2" />
                    {t('actions.addAsRef', '이미지 참조')}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onOpenFolder(image)}>
                    <FolderOpen className="h-4 w-4 mr-2" />
                    {t('actions.openFolder', '폴더 열기')}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onLoadMetadata(image)}>
                    <FileSearch className="h-4 w-4 mr-2" />
                    {t('metadata.loadFromImage', '메타데이터 불러오기')}
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    )
})

export function HistoryPanel() {
    const { t } = useTranslation()
    const { setPreviewImage, isGenerating, setIsGenerating, setSeed } = useGenerationStore()
    const { savePath, useAbsolutePath } = useSettingsStore()
    const [savedImages, setSavedImages] = useState<SavedImage[]>([])
    const [imageThumbnails, setImageThumbnails] = useState<Record<string, string>>({})
    const [isLoading, setIsLoading] = useState(false)
    const [metadataDialogOpen, setMetadataDialogOpen] = useState(false)
    const [selectedImageForMetadata, setSelectedImageForMetadata] = useState<string | undefined>()
    const [imageRefDialogOpen, setImageRefDialogOpen] = useState(false)
    const [selectedImageForRef, setSelectedImageForRef] = useState<string | null>(null)
    const prevIsGenerating = useRef(isGenerating)
    const navigate = useNavigate()
    const { setActiveImage } = useToolsStore()



    const handleImageLoadComplete = useCallback((path: string, data: string) => {
        setImageThumbnails(prev => {
            if (prev[path]) return prev
            return { ...prev, [path]: data }
        })
    }, [])

    // Add new image instantly to history (no compression - use original directly)
    const addNewImage = useCallback((imagePath: string, imageData: string) => {
        const timestamp = Date.now()
        const name = imagePath.split(/[/\\]/).pop() || `NAIS_${timestamp}.png`

        const newImage: SavedImage = {
            name,
            path: imagePath,
            timestamp,
            type: imagePath.includes('NAIS_Scene') ? 'scene' :
                name.includes('INPAINT_') ? 'inpaint' :
                    name.includes('I2I_') ? 'i2i' :
                        name.includes('UPSCALE_') ? 'upscale' : 'main'
        }

        // Instantly add to list with original data
        setSavedImages(prev => [newImage, ...prev].slice(0, 20))
        setImageThumbnails(prev => ({ ...prev, [imagePath]: imageData }))
    }, [])

    const getGenerationType = (name: string): 'main' | 'i2i' | 'inpaint' | 'upscale' | 'scene' => {
        if (name.includes('INPAINT_')) return 'inpaint'
        if (name.includes('I2I_')) return 'i2i'
        if (name.includes('UPSCALE_')) return 'upscale'
        if (name.includes('SCENE_')) return 'scene'
        return 'main'
    }

    // Get icon component for generation type
    const getTypeIcon = (type: 'main' | 'i2i' | 'inpaint' | 'upscale' | 'scene') => {
        switch (type) {
            case 'i2i': return <ImageIcon className="h-3 w-3 text-indigo-400" />
            case 'inpaint': return <Paintbrush className="h-3 w-3 text-pink-400" />
            case 'upscale': return <Maximize2 className="h-3 w-3 text-purple-400" />
            case 'scene': return <Film className="h-3 w-3 text-emerald-400" />
            default: return <ImageIcon className="h-3 w-3 text-amber-500" />
        }
    }

    // Load images from save path
    const loadSavedImages = async () => {
        setIsLoading(true)
        try {
            const images: SavedImage[] = []
            const picturePath = await pictureDir()

            // 1. Load Main Output Images - Always load from Pictures/NAIS_Output first
            const defaultOutputDir = 'NAIS_Output'

            // Always load from Pictures/NAIS_Output for backward compatibility
            try {
                if (await exists(defaultOutputDir, { baseDir: BaseDirectory.Picture })) {
                    const entries = await readDir(defaultOutputDir, { baseDir: BaseDirectory.Picture })

                    for (const entry of entries) {
                        if (entry.name && (entry.name.toLowerCase().endsWith('.png') || entry.name.toLowerCase().endsWith('.jpg') || entry.name.toLowerCase().endsWith('.webp'))) {
                            const fullPath = await join(picturePath, defaultOutputDir, entry.name)
                            const match = entry.name.match(/_(\d+)\.[^.]+$/)
                            const timestamp = match ? parseInt(match[1]) : 0
                            images.push({
                                name: entry.name,
                                path: fullPath,
                                timestamp,
                                type: getGenerationType(entry.name)
                            })
                        }
                    }
                }
            } catch (e) {
                console.warn('Failed to load from default Pictures folder:', e)
            }

            // Additionally load from absolute path if set
            if (useAbsolutePath && savePath) {
                try {
                    if (await exists(savePath)) {
                        const entries = await readDir(savePath)

                        for (const entry of entries) {
                            if (entry.name && (entry.name.toLowerCase().endsWith('.png') || entry.name.toLowerCase().endsWith('.jpg') || entry.name.toLowerCase().endsWith('.webp'))) {
                                const fullPath = await join(savePath, entry.name)

                                // Skip duplicates
                                if (images.some(img => img.path === fullPath)) continue

                                const match = entry.name.match(/_(\d+)\.[^.]+$/)
                                const timestamp = match ? parseInt(match[1]) : 0
                                images.push({
                                    name: entry.name,
                                    path: fullPath,
                                    timestamp,
                                    type: getGenerationType(entry.name)
                                })
                            }
                        }
                    }
                } catch (e) {
                    console.warn('Failed to load from absolute path:', e)
                }
            }

            // 2. Load Scene Images (Recursive) - Always load from Pictures, plus absolute path if set
            const sceneBaseDir = 'NAIS_Scene'
            const scenePicturePath = await pictureDir()

            // Helper function to load scene images from a directory (supports presetName/sceneName structure)
            const loadSceneImagesFromDir = async (baseDir: string, useBaseDir: boolean = false) => {
                try {
                    const checkExists = useBaseDir
                        ? await exists(sceneBaseDir, { baseDir: BaseDirectory.Picture })
                        : await exists(baseDir)

                    if (!checkExists) return

                    const presetOrSceneDirs = useBaseDir
                        ? await readDir(sceneBaseDir, { baseDir: BaseDirectory.Picture })
                        : await readDir(baseDir)

                    for (const presetOrSceneDir of presetOrSceneDirs) {
                        if (presetOrSceneDir.isDirectory) {
                            try {
                                const presetFolderPath = useBaseDir
                                    ? `${sceneBaseDir}/${presetOrSceneDir.name}`
                                    : await join(baseDir, presetOrSceneDir.name)

                                const presetContents = useBaseDir
                                    ? await readDir(presetFolderPath, { baseDir: BaseDirectory.Picture })
                                    : await readDir(presetFolderPath)

                                for (const item of presetContents) {
                                    if (item.isDirectory) {
                                        // This is the sceneName folder (new structure: presetName/sceneName/)
                                        const sceneFolderPath = useBaseDir
                                            ? `${presetFolderPath}/${item.name}`
                                            : await join(presetFolderPath, item.name)

                                        const sceneFiles = useBaseDir
                                            ? await readDir(sceneFolderPath, { baseDir: BaseDirectory.Picture })
                                            : await readDir(sceneFolderPath)

                                        for (const file of sceneFiles) {
                                            if (file.name && (file.name.toLowerCase().endsWith('.png') || file.name.toLowerCase().endsWith('.jpg') || file.name.toLowerCase().endsWith('.webp'))) {
                                                const fullPath = useBaseDir
                                                    ? await join(scenePicturePath, sceneBaseDir, presetOrSceneDir.name, item.name, file.name)
                                                    : await join(sceneFolderPath, file.name)

                                                if (images.some(img => img.path === fullPath)) continue

                                                const match = file.name.match(/_(\d+)\.[^.]+$/)
                                                const timestamp = match ? parseInt(match[1]) : 0

                                                images.push({
                                                    name: file.name,
                                                    path: fullPath,
                                                    timestamp,
                                                    type: 'scene'
                                                })
                                            }
                                        }
                                    } else if (item.name && (item.name.toLowerCase().endsWith('.png') || item.name.toLowerCase().endsWith('.jpg') || item.name.toLowerCase().endsWith('.webp'))) {
                                        // This is a direct image file (old structure: sceneName/image.png)
                                        const fullPath = useBaseDir
                                            ? await join(scenePicturePath, sceneBaseDir, presetOrSceneDir.name, item.name)
                                            : await join(presetFolderPath, item.name)

                                        if (images.some(img => img.path === fullPath)) continue

                                        const match = item.name.match(/_(\d+)\.[^.]+$/)
                                        const timestamp = match ? parseInt(match[1]) : 0

                                        images.push({
                                            name: item.name,
                                            path: fullPath,
                                            timestamp,
                                            type: 'scene'
                                        })
                                    }
                                }
                            } catch (e) {
                                console.warn(`Failed to read preset/scene dir ${presetOrSceneDir.name}:`, e)
                            }
                        }
                    }
                } catch (e) {
                    console.warn('Failed to load scene images from:', baseDir, e)
                }
            }

            // Always load from Pictures/NAIS_Scene (for backward compatibility)
            await loadSceneImagesFromDir(sceneBaseDir, true)

            // Additionally load from absolute path if set
            if (useAbsolutePath && savePath) {
                const absoluteSceneDir = await join(savePath, sceneBaseDir)
                await loadSceneImagesFromDir(absoluteSceneDir, false)
            }

            images.sort((a, b) => b.timestamp - a.timestamp)
            setSavedImages(images)

            // NOTE: Removed pre-loading of thumbnails using readFile to prevent UI lag.
            // Using convertFileSrc in the render loop is much more efficient as it uses native asset handling.
        } catch (error) {
            console.error('Failed to load history:', error)
            setSavedImages([])
        }
        setIsLoading(false)
    }

    useEffect(() => {
        loadSavedImages()
    }, [savePath])

    // Listen for instant image updates from generation
    useEffect(() => {
        const handler = (e: CustomEvent<{ path: string; data: string }>) => {
            const { path, data } = e.detail
            addNewImage(path, data)
        }

        window.addEventListener('newImageGenerated', handler as EventListener)
        return () => window.removeEventListener('newImageGenerated', handler as EventListener)
    }, [addNewImage])

    // Fallback auto-refresh when generation completes (if event wasn't fired)
    useEffect(() => {
        if (prevIsGenerating.current && !isGenerating) {
            const timer = setTimeout(() => loadSavedImages(), 2000)
            return () => clearTimeout(timer)
        }
        prevIsGenerating.current = isGenerating
    }, [isGenerating])

    // Auto-refresh when scene generates images (triggered by scene store)
    const historyRefreshTrigger = useSceneStore(s => s.historyRefreshTrigger)
    const prevTrigger = useRef(historyRefreshTrigger)
    useEffect(() => {
        if (prevTrigger.current !== historyRefreshTrigger && historyRefreshTrigger > 0) {
            // Scene generation added an image, refresh after delay
            const timer = setTimeout(() => loadSavedImages(), 1500)
            prevTrigger.current = historyRefreshTrigger
            return () => clearTimeout(timer)
        }
    }, [historyRefreshTrigger])


    const handleImageClick = async (image: SavedImage) => {
        let finalDataUrl = imageThumbnails[image.path]

        // Load if missing
        if (!finalDataUrl) {
            try {
                const data = await readFile(image.path)
                const base64 = arrayBufferToBase64(data)
                finalDataUrl = `data:image/png;base64,${base64}`
                setImageThumbnails(prev => ({ ...prev, [image.path]: finalDataUrl }))
            } catch (e) {
                console.error('Failed to load image:', e)
                return
            }
        }

        // Set preview
        setPreviewImage(finalDataUrl)

        // Sync Seed
        try {
            const metadata = await parseMetadataFromBase64(finalDataUrl)
            if (metadata && metadata.seed) {
                setSeed(metadata.seed)
            }
        } catch (error) {
            console.warn('Failed to parse metadata for seed sync:', error)
        }

        navigate('/') // Navigate to main mode to show the image
    }

    const handleDeleteImage = async (image: SavedImage, e?: React.MouseEvent) => {
        e?.stopPropagation()
        try {
            await remove(image.path)
            setSavedImages(prev => prev.filter(img => img.path !== image.path))
            setImageThumbnails(prev => {
                const next = { ...prev }
                delete next[image.path]
                return next
            })
        } catch (e) {
            console.error('Failed to delete image:', e)
        }
    }

    const handleLoadMetadata = async (image: SavedImage) => {
        let imageData = imageThumbnails[image.path]

        if (!imageData) {
            try {
                const data = await readFile(image.path)
                const base64 = arrayBufferToBase64(data)
                imageData = `data:image/png;base64,${base64}`
                setImageThumbnails(prev => ({ ...prev, [image.path]: imageData }))
            } catch {
                return
            }
        }

        setSelectedImageForMetadata(imageData)
        setMetadataDialogOpen(true)
    }

    const handleCopyImage = async (image: SavedImage) => {
        const imageData = imageThumbnails[image.path]
        if (!imageData) return

        try {
            const response = await fetch(imageData)
            const blob = await response.blob()
            await navigator.clipboard.write([
                new ClipboardItem({ [blob.type]: blob })
            ])
        } catch (e) {
            console.error('Copy failed:', e)
        }
    }

    // Regenerate image with its metadata
    const handleRegenerate = async (image: SavedImage) => {
        const imageData = imageThumbnails[image.path]
        if (!imageData || isGenerating) return

        const token = useAuthStore.getState().token
        if (!token) {
            toast({ title: t('toast.tokenRequired.title', '토큰 필요'), variant: 'destructive' })
            return
        }

        try {
            const metadata = await parseMetadataFromBase64(imageData)
            if (!metadata) {
                toast({
                    title: t('toast.noMetadata', '메타데이터 없음'),
                    description: t('toast.noMetadataDesc', '이 이미지에서 메타데이터를 찾을 수 없습니다'),
                    variant: 'destructive',
                })
                return
            }

            setIsGenerating(true)
            const newSeed = Math.floor(Math.random() * 4294967295)

            // Map model name to API ID
            const mapModelNameToId = (name?: string): string => {
                if (!name) return 'nai-diffusion-4-5-full'
                const lower = name.toLowerCase()
                if (lower.includes('4.5') || lower.includes('4-5')) {
                    if (lower.includes('curated')) return 'nai-diffusion-4-5-curated'
                    return 'nai-diffusion-4-5-full'
                }
                if (lower.includes('v4') || lower.includes('4')) {
                    if (lower.includes('curated')) return 'nai-diffusion-4-curated-preview'
                    return 'nai-diffusion-4-full'
                }
                if (lower.includes('furry')) return 'nai-diffusion-furry-3'
                if (lower.includes('v3') || lower.includes('3')) return 'nai-diffusion-3'
                return 'nai-diffusion-4-5-full'
            }

            const result = await generateImage(token, {
                prompt: metadata.prompt || '',
                negative_prompt: metadata.negativePrompt || '',
                model: mapModelNameToId(metadata.model),
                width: metadata.width || 832,
                height: metadata.height || 1216,
                steps: metadata.steps || 28,
                cfg_scale: metadata.cfgScale || 5,
                cfg_rescale: metadata.cfgRescale || 0,
                sampler: metadata.sampler || 'k_euler',
                scheduler: metadata.scheduler || 'native',
                smea: metadata.smea ?? true,
                smea_dyn: metadata.smeaDyn ?? false,
                variety: metadata.variety ?? false,
                seed: newSeed,
            })

            if (result.success && result.imageData) {
                setPreviewImage(`data:image/png;base64,${result.imageData}`)

                // Save to disk if autoSave is enabled
                const { autoSave, useAbsolutePath } = useSettingsStore.getState()
                if (autoSave) {
                    try {
                        const binaryString = atob(result.imageData)
                        const bytes = new Uint8Array(binaryString.length)
                        for (let j = 0; j < binaryString.length; j++) {
                            bytes[j] = binaryString.charCodeAt(j)
                        }

                        const fileName = `NAIS_${Date.now()}.png`
                        const outputDir = savePath || 'NAIS_Output'

                        let fullPath: string

                        if (useAbsolutePath) {
                            // Save to absolute path directly
                            const dirExists = await exists(outputDir)
                            if (!dirExists) {
                                await mkdir(outputDir, { recursive: true })
                            }
                            fullPath = await join(outputDir, fileName)
                            await writeFile(fullPath, bytes)
                        } else {
                            // Save relative to Pictures directory
                            const dirExists = await exists(outputDir, { baseDir: BaseDirectory.Picture })
                            if (!dirExists) {
                                await mkdir(outputDir, { baseDir: BaseDirectory.Picture })
                            }
                            await writeFile(`${outputDir}/${fileName}`, bytes, { baseDir: BaseDirectory.Picture })
                            const picPath = await pictureDir()
                            fullPath = await join(picPath, outputDir, fileName)
                        }

                        // Dispatch event for instant history update
                        try {
                            window.dispatchEvent(new CustomEvent('newImageGenerated', {
                                detail: { path: fullPath, data: `data:image/png;base64,${result.imageData}` }
                            }))
                        } catch (e) {
                            console.warn('Failed to dispatch newImageGenerated event:', e)
                        }
                    } catch (e) {
                        console.warn('Failed to save regenerated image:', e)
                    }
                }

                toast({ title: t('toast.regenerated', '재생성 완료'), variant: 'success' })
            } else {
                toast({ title: t('toast.generateFailed', '생성 실패'), description: result.error, variant: 'destructive' })
            }
        } catch (e) {
            console.error('Regenerate failed:', e)
        } finally {
            setIsGenerating(false)
        }
    }

    // Open folder containing saved images
    const handleOpenFolder = async (image: SavedImage) => {
        try {
            await Command.create('explorer', ['/select,', image.path]).execute()
        } catch (e) {
            console.error('Failed to open folder:', e)
        }
    }

    const handleOpenSmartTools = async (image: SavedImage) => {
        setIsLoading(true)
        try {
            // Read full image file to pass to tools
            const data = await readFile(image.path)
            const base64 = `data:image/png;base64,${arrayBufferToBase64(data)}`
            setActiveImage(base64)
            navigate('/tools')
        } catch (e) {
            toast({ title: t('smartTools.error', '이미지 로드 실패'), variant: 'destructive' })
        } finally {
            setIsLoading(false)
        }
    }

    const handleSaveAs = async (image: SavedImage) => {
        try {
            const data = await readFile(image.path)
            const filePath = await save({
                defaultPath: image.name,
                filters: [{ name: 'PNG Image', extensions: ['png'] }],
            })
            if (filePath) {
                await writeFile(filePath, data)
                toast({ title: t('toast.saved', '저장 완료'), variant: 'success' })
            }
        } catch (e) {
            console.error('Save failed:', e)
            toast({ title: t('toast.saveFailed', '저장 실패'), variant: 'destructive' })
        }
    }

    const handleAddAsReference = async (image: SavedImage) => {
        let imageData = imageThumbnails[image.path]
        if (!imageData) {
            try {
                const data = await readFile(image.path)
                const base64 = arrayBufferToBase64(data)
                imageData = `data:image/png;base64,${base64}`
            } catch { return }
        }
        setSelectedImageForRef(imageData)
        setImageRefDialogOpen(true)
    }

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="h-12 flex items-center justify-between px-4">
                <span className="text-sm font-medium flex items-center gap-2">
                    <FolderOpen className="h-4 w-4 text-amber-400" />
                    {t('history.title')}
                </span>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                        {t('history.count', { count: savedImages.length })}
                    </span>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={loadSavedImages}
                        disabled={isLoading}
                    >
                        <RefreshCw className={`h-3.5 w-3.5 text-muted-foreground ${isLoading ? 'animate-spin' : ''}`} />
                    </Button>
                </div>
            </div>

            {/* History Grid */}
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                {savedImages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground opacity-50">
                        <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center mb-3">
                            <Clock className="h-6 w-6 opacity-50" />
                        </div>
                        <span className="text-xs">{t('history.empty')}</span>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-2">
                        {savedImages.slice(0, 20).map((image, index) => (
                            <HistoryImageItem
                                key={image.path}
                                image={image}
                                thumbnail={imageThumbnails[image.path]}
                                onLoadComplete={handleImageLoadComplete}
                                index={index}
                                isGenerating={isGenerating}
                                getTypeIcon={getTypeIcon}
                                onImageClick={handleImageClick}
                                onDelete={handleDeleteImage}
                                onSaveAs={handleSaveAs}
                                onCopy={handleCopyImage}
                                onRegenerate={handleRegenerate}
                                onOpenSmartTools={handleOpenSmartTools}
                                onAddAsReference={handleAddAsReference}
                                onOpenFolder={handleOpenFolder}
                                onLoadMetadata={handleLoadMetadata}
                            />
                        ))}
                    </div>
                )}
            </div>

            <MetadataDialog
                open={metadataDialogOpen}
                onOpenChange={(open) => {
                    setMetadataDialogOpen(open)
                    if (!open) setSelectedImageForMetadata(undefined)
                }}
                initialImage={selectedImageForMetadata}
            />

            <ImageReferenceDialog
                open={imageRefDialogOpen}
                onOpenChange={setImageRefDialogOpen}
                imageBase64={selectedImageForRef}
            />
        </div>
    )
}
