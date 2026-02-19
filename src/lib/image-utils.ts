/**
 * Image utility functions for memory-efficient image handling
 */

/**
 * Generate thumbnail from base64 image (max 256px, JPEG quality 0.7)
 * Memory-safe: properly releases canvas and image resources
 * 
 * @param base64Image - Full base64 image string (with data: prefix)
 * @param maxSize - Maximum dimension for thumbnail (default 256px)
 * @returns Promise resolving to thumbnail base64 string (~10-30KB)
 */
export const createThumbnail = (base64Image: string, maxSize = 256): Promise<string> => {
    return new Promise((resolve) => {
        const img = new Image()
        img.onload = () => {
            let canvas: HTMLCanvasElement | null = null
            try {
                canvas = document.createElement('canvas')
                const ctx = canvas.getContext('2d')

                if (!ctx) {
                    resolve(base64Image) // Fallback to original
                    return
                }

                // Calculate thumbnail dimensions maintaining aspect ratio
                let width = img.width
                let height = img.height
                if (width > height) {
                    if (width > maxSize) {
                        height = Math.round(height * maxSize / width)
                        width = maxSize
                    }
                } else {
                    if (height > maxSize) {
                        width = Math.round(width * maxSize / height)
                        height = maxSize
                    }
                }

                canvas.width = width
                canvas.height = height
                ctx.drawImage(img, 0, 0, width, height)

                // Use JPEG for smaller size (~10-30KB instead of 2-5MB)
                const thumbnail = canvas.toDataURL('image/jpeg', 0.7)
                resolve(thumbnail)
            } catch {
                resolve(base64Image) // Fallback to original on error
            } finally {
                // CRITICAL: Release canvas memory to prevent OOM
                if (canvas) {
                    canvas.width = 0
                    canvas.height = 0
                }
                // Help GC by clearing image reference
                img.src = ''
            }
        }
        img.onerror = () => {
            img.src = '' // Clear on error too
            resolve(base64Image) // Fallback to original
        }
        img.src = base64Image
    })
}

/**
 * Reference image file management utilities
 * Stores images in AppData/NAIS2/references/ to avoid memory bloat
 */

import { appDataDir, join } from '@tauri-apps/api/path'
import { writeFile, readFile, remove, mkdir, exists } from '@tauri-apps/plugin-fs'

const REFERENCES_DIR = 'references'

/**
 * Get the references directory path
 */
export const getReferencesDir = async (): Promise<string> => {
    const appData = await appDataDir()
    return await join(appData, REFERENCES_DIR)
}

/**
 * Ensure references directory exists
 */
export const ensureReferencesDir = async (): Promise<string> => {
    const refDir = await getReferencesDir()
    if (!(await exists(refDir))) {
        await mkdir(refDir, { recursive: true })
    }
    return refDir
}

/**
 * Save base64 image to file and return file path
 * @param base64Image - Full base64 string (with data: prefix)
 * @param id - Unique identifier for the file
 * @param type - 'character' or 'vibe'
 * @returns File path
 */
export const saveReferenceImage = async (
    base64Image: string, 
    id: string, 
    type: 'character' | 'vibe'
): Promise<string> => {
    const refDir = await ensureReferencesDir()
    
    // Extract base64 data (remove data:image/...;base64, prefix)
    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '')
    const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0))
    
    // Determine extension from data prefix
    const ext = base64Image.includes('image/webp') ? 'webp' : 'png'
    const fileName = `${type}_${id}.${ext}`
    const filePath = await join(refDir, fileName)
    
    await writeFile(filePath, binaryData)
    console.log(`[ImageUtils] Saved reference image: ${filePath}`)
    
    return filePath
}

/**
 * Load base64 image from file path
 * @param filePath - Absolute file path
 * @returns Base64 string with data: prefix, or null if file doesn't exist
 */
export const loadReferenceImage = async (filePath: string): Promise<string | null> => {
    try {
        if (!(await exists(filePath))) {
            console.warn(`[ImageUtils] Reference image not found: ${filePath}`)
            return null
        }
        
        const data = await readFile(filePath)
        const base64 = btoa(String.fromCharCode(...data))
        
        // Determine mime type from extension
        const ext = filePath.toLowerCase().split('.').pop()
        const mimeType = ext === 'webp' ? 'image/webp' : 'image/png'
        
        return `data:${mimeType};base64,${base64}`
    } catch (e) {
        console.error(`[ImageUtils] Failed to load reference image: ${filePath}`, e)
        return null
    }
}

/**
 * Delete reference image file
 * @param filePath - Absolute file path
 */
export const deleteReferenceImage = async (filePath: string): Promise<void> => {
    try {
        if (await exists(filePath)) {
            await remove(filePath)
            console.log(`[ImageUtils] Deleted reference image: ${filePath}`)
        }
    } catch (e) {
        console.error(`[ImageUtils] Failed to delete reference image: ${filePath}`, e)
    }
}

/**
 * Check if a path is a file path (not base64)
 */
export const isFilePath = (str: string): boolean => {
    return !str.startsWith('data:') && (
        str.includes('/') || str.includes('\\') || 
        str.endsWith('.png') || str.endsWith('.webp') || str.endsWith('.jpg')
    )
}
