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
