import { StateStorage } from 'zustand/middleware'
// Since I cannot install packages, I will implement a minimal wrapper similar to idb-keyval logic
// or I can implement a raw IndexedDB wrapper.
// Given constraints, raw IndexedDB is safer as strict dependency rules apply.

const DB_NAME = 'nais2-db'
const STORE_NAME = 'keyval'

const dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME)
        }
    }
    request.onsuccess = () => {
        resolve(request.result)
    }
    request.onerror = () => reject(request.error)
})

export const indexedDBStorage: StateStorage = {
    getItem: async (name: string): Promise<string | null> => {
        const db = await dbPromise
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readonly')
            const store = transaction.objectStore(STORE_NAME)
            const request = store.get(name)
            request.onsuccess = () => resolve(request.result as string || null)
            request.onerror = () => reject(request.error)
        })
    },
    setItem: async (name: string, value: string): Promise<void> => {
        const db = await dbPromise
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite')
            const store = transaction.objectStore(STORE_NAME)
            const request = store.put(value, name)
            request.onsuccess = () => resolve()
            request.onerror = () => reject(request.error)
        })
    },
    removeItem: async (name: string): Promise<void> => {
        const db = await dbPromise
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite')
            const store = transaction.objectStore(STORE_NAME)
            const request = store.delete(name)
            request.onsuccess = () => resolve()
            request.onerror = () => reject(request.error)
        })
    },
}

/**
 * 특정 키의 데이터 크기가 너무 크면 정리
 * (대용량 wildcard 데이터 마이그레이션 이슈 해결용)
 */
export async function cleanupLargeData(key: string, maxSizeKB: number = 100): Promise<boolean> {
    try {
        const data = await indexedDBStorage.getItem(key)
        if (data && data.length > maxSizeKB * 1024) {
            console.warn(`[IndexedDB] ${key} data is too large (${(data.length / 1024).toFixed(1)}KB), cleaning up...`)
            
            // JSON 파싱해서 content 필드 제거
            try {
                const parsed = JSON.parse(data)
                if (parsed.state?.files) {
                    parsed.state.files = parsed.state.files.map((f: any) => {
                        const { content, ...meta } = f
                        return {
                            ...meta,
                            lineCount: Array.isArray(content) ? content.length : (meta.lineCount || 0)
                        }
                    })
                    parsed.state._migrated = true
                    await indexedDBStorage.setItem(key, JSON.stringify(parsed))
                    console.log(`[IndexedDB] ${key} cleaned up successfully`)
                    return true
                }
            } catch {
                // JSON 파싱 실패하면 그냥 삭제
                await indexedDBStorage.removeItem(key)
                console.log(`[IndexedDB] ${key} removed due to parse error`)
                return true
            }
        }
        return false
    } catch (error) {
        console.error('[IndexedDB] cleanup error:', error)
        return false
    }
}

/**
 * IndexedDB 내부에서 스토어 이름 변경 마이그레이션
 * 기존 이름의 데이터가 있고 새 이름에 데이터가 없으면 이동
 * 
 * @param renames - [oldName, newName] 배열
 */
export async function migrateIndexedDBKeys(renames: [string, string][]): Promise<void> {
    for (const [oldKey, newKey] of renames) {
        try {
            // 새 키에 이미 데이터가 있으면 스킵
            const newData = await indexedDBStorage.getItem(newKey)
            if (newData) {
                console.log(`[IndexedDB Migration] ${newKey}: Already has data, skipping`)
                // 기존 키 정리
                const oldData = await indexedDBStorage.getItem(oldKey)
                if (oldData) {
                    await indexedDBStorage.removeItem(oldKey)
                    console.log(`[IndexedDB Migration] ${oldKey}: Cleaned up old key`)
                }
                continue
            }

            // 기존 키에 데이터가 있는지 확인
            const oldData = await indexedDBStorage.getItem(oldKey)
            if (!oldData) {
                console.log(`[IndexedDB Migration] ${oldKey}: No data to migrate`)
                continue
            }

            // 새 키로 복사
            console.log(`[IndexedDB Migration] ${oldKey} → ${newKey}: Migrating ${oldData.length} bytes`)
            await indexedDBStorage.setItem(newKey, oldData)

            // 검증
            const verifyData = await indexedDBStorage.getItem(newKey)
            if (verifyData && verifyData.length === oldData.length) {
                // 검증 성공 - 기존 키 삭제
                await indexedDBStorage.removeItem(oldKey)
                console.log(`[IndexedDB Migration] ${oldKey} → ${newKey}: Complete`)
            } else {
                console.error(`[IndexedDB Migration] ${oldKey} → ${newKey}: Verification failed!`)
            }
        } catch (error) {
            console.error(`[IndexedDB Migration] ${oldKey} → ${newKey}: Failed`, error)
        }
    }
}

/**
 * localStorage에서 IndexedDB로 데이터 마이그레이션
 * 기존 localStorage 데이터가 있고 IndexedDB에 없으면 이동
 * 
 * CRITICAL: This MUST complete before Zustand stores initialize!
 */
export async function migrateFromLocalStorage(keys: string[]): Promise<void> {
    for (const key of keys) {
        try {
            // localStorage에 데이터가 있는지 확인
            const localData = localStorage.getItem(key)
            if (!localData) {
                console.log(`[Migration] ${key}: No localStorage data`)
                continue
            }

            // IndexedDB에 이미 데이터가 있는지 확인
            const indexedData = await indexedDBStorage.getItem(key)
            if (indexedData) {
                // 이미 IndexedDB에 데이터 있으면 localStorage 정리만
                console.log(`[Migration] ${key}: IndexedDB already has data, cleaning localStorage`)
                localStorage.removeItem(key)
                continue
            }

            // localStorage → IndexedDB 마이그레이션
            console.log(`[Migration] ${key}: Migrating ${localData.length} bytes from localStorage to IndexedDB`)
            await indexedDBStorage.setItem(key, localData)
            
            // 검증: 제대로 저장되었는지 확인
            const verifyData = await indexedDBStorage.getItem(key)
            if (verifyData && verifyData.length === localData.length) {
                // 검증 성공 - localStorage 정리
                localStorage.removeItem(key)
                console.log(`[Migration] ${key}: Migration verified and complete`)
            } else {
                // 검증 실패 - localStorage 유지 (데이터 손실 방지)
                console.error(`[Migration] ${key}: Verification failed! Keeping localStorage data`)
            }
        } catch (error) {
            console.error(`[Migration] ${key}: Migration failed, keeping localStorage data`, error)
            // 실패해도 localStorage 데이터는 유지 - 다음 시작에 다시 시도
        }
    }
}
