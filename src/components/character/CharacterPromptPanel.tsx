import { useState, useEffect, useRef, useCallback, MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
    X,
    Plus,
    Trash2,
    Users,
    ChevronDown,
    ChevronUp,
    MapPin,
    Eye,
    EyeOff,
    Copy,
    User,
    SlidersHorizontal,
    Pencil,
    Search,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AutocompleteTextarea } from '@/components/ui/AutocompleteTextarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { useCharacterPromptStore, CHARACTER_COLORS, CharacterPrompt } from '@/stores/character-prompt-store'
import { useSettingsStore } from '@/stores/settings-store'
import { cn } from '@/lib/utils'
import {
    DndContext,
    closestCenter,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from '@dnd-kit/core'
import {
    SortableContext,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers'

interface CharacterPromptPanelProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function CharacterPromptPanel({ open, onOpenChange }: CharacterPromptPanelProps) {
    const { t } = useTranslation()
    const {
        characters,
        addCharacter,
        updateCharacter,
        removeCharacter,
        setPosition,
        toggleEnabled,
        positionEnabled,
        setPositionEnabled,
        reorderCharacters,
    } = useCharacterPromptStore()

    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [positionDialogOpen, setPositionDialogOpen] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')

    // DnD sensors
    // 키보드 센서 제거 (입력창 스페이스바/엔터 충돌 방지)
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        })
    )

    const handleDragStart = () => {
        // 드래그 시작 시 펼쳐진 카드 닫기
        setExpandedId(null)
    }

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event
        if (over && active.id !== over.id) {
            const oldIndex = characters.findIndex(c => c.id === active.id)
            const newIndex = characters.findIndex(c => c.id === over.id)
            reorderCharacters(oldIndex, newIndex)
        }
    }


    // 검색 필터링된 캐릭터 목록
    const filteredCharacters = characters.filter(char => {
        if (!searchQuery.trim()) return true
        const query = searchQuery.toLowerCase()
        const name = char.name?.toLowerCase() || ''
        const promptPreview = char.prompt?.split(',')[0]?.trim().toLowerCase() || ''
        return name.includes(query) || promptPreview.includes(query)
    })

    // 패널 열릴 때 첫 번째 캐릭터 펼치기
    useEffect(() => {
        if (open && characters.length > 0 && !expandedId) {
            setExpandedId(characters[0].id)
        }
    }, [open, characters.length])

    const handleAddCharacter = () => {
        addCharacter()
        // 새 캐릭터 자동 확장
        setTimeout(() => {
            const newChar = useCharacterPromptStore.getState().characters.slice(-1)[0]
            if (newChar) {
                setExpandedId(newChar.id)
            }
        }, 0)
    }

    const handleDuplicate = useCallback((char: CharacterPrompt) => {
        addCharacter()
        setTimeout(() => {
            const newChar = useCharacterPromptStore.getState().characters.slice(-1)[0]
            if (newChar) {
                updateCharacter(newChar.id, {
                    prompt: char.prompt,
                    negative: char.negative,
                })
                setExpandedId(newChar.id)
            }
        }, 0)
    }, [addCharacter, updateCharacter])

    const handleToggleExpand = useCallback((id: string) => {
        setExpandedId(prev => prev === id ? null : id)
    }, [])

    if (!open) return null

    return (
        <>
            {/* 패널 - absolute로 프롬프트 영역 위에 오버레이 */}
            <div
                className={cn(
                    "absolute inset-0 z-10 flex flex-col bg-muted/95 backdrop-blur-sm rounded-xl border border-border/50",
                    "animate-in slide-in-from-bottom-4 duration-200"
                )}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border/30 shrink-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                        <Users className="h-4 w-4 text-primary" />
                        <span>{t('characterPanel.title', '캐릭터 프롬프트')}</span>
                        {characters.filter(c => c.enabled).length > 0 && (
                            <span className="text-xs text-muted-foreground">
                                ({characters.filter(c => c.enabled).length})
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-1">
                        {/* 위치 설정 다이얼로그 (활성화 시에만) - 왼쪽에 배치 */}
                        {positionEnabled && (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => setPositionDialogOpen(true)}
                                title={t('characterPanel.positionTitle', '캐릭터 위치 지정')}
                            >
                                <SlidersHorizontal className="h-3.5 w-3.5" />
                            </Button>
                        )}
                        {/* 위치 활성화 토글 */}
                        <Button
                            variant={positionEnabled ? "default" : "ghost"}
                            size="icon"
                            className={cn(
                                "h-7 w-7",
                                positionEnabled && "bg-primary text-primary-foreground"
                            )}
                            onClick={() => setPositionEnabled(!positionEnabled)}
                            title={t('characterPanel.position', '위치')}
                        >
                            <MapPin className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={handleAddCharacter}
                            title={t('characterPanel.add', '추가')}
                        >
                            <Plus className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 hover:bg-destructive/20 hover:text-destructive"
                            onClick={() => onOpenChange(false)}
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {/* Search Input */}
                {characters.length > 0 && (
                    <div className="px-3 py-2 border-b border-border/30 shrink-0">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                            <Input
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder={t('characterPanel.search', '캐릭터 검색...')}
                                className="h-8 pl-8 text-sm"
                            />
                        </div>
                    </div>
                )}

                {/* Character Cards - Vertical List with Drag Reorder */}
                <ScrollArea className="flex-1 min-h-0">
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                    >
                        <SortableContext
                            items={characters.map(c => c.id)}
                            strategy={verticalListSortingStrategy}
                        >
                            <div className="flex flex-col gap-2 p-3">
                                {characters.length === 0 ? (
                                    <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm py-12">
                                        <div className="text-center">
                                            <Users className="h-8 w-8 mx-auto mb-2 opacity-30" />
                                            <p>{t('characterPanel.empty', '캐릭터가 없습니다')}</p>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="mt-2"
                                                onClick={handleAddCharacter}
                                            >
                                                <Plus className="h-3.5 w-3.5 mr-1" />
                                                {t('characterPanel.addFirst', '첫 캐릭터 추가')}
                                            </Button>
                                        </div>
                                    </div>
                                ) : filteredCharacters.length === 0 ? (
                                    <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm py-12">
                                        <div className="text-center">
                                            <Search className="h-8 w-8 mx-auto mb-2 opacity-30" />
                                            <p>{t('characterPanel.noResults', '검색 결과가 없습니다')}</p>
                                        </div>
                                    </div>
                                ) : (
                                    filteredCharacters.map((char) => {
                                        const index = characters.findIndex(c => c.id === char.id)
                                        return (
                                            <SortableCharacterCard
                                                key={char.id}
                                                character={char}
                                                index={index}
                                                isExpanded={expandedId === char.id}
                                                onToggleExpand={() => handleToggleExpand(char.id)}
                                                onUpdate={(data) => updateCharacter(char.id, data)}
                                                onRemove={() => removeCharacter(char.id)}
                                                onToggleEnabled={() => toggleEnabled(char.id)}
                                                onDuplicate={() => handleDuplicate(char)}
                                                positionEnabled={positionEnabled}
                                            />
                                        )
                                    })
                                )}
                            </div>
                        </SortableContext>
                    </DndContext>
                </ScrollArea>
            </div>

            {/* Position Dialog */}
            <PositionDialog
                open={positionDialogOpen}
                onOpenChange={setPositionDialogOpen}
                characters={characters}
                onPositionChange={setPosition}
            />
        </>
    )
}

// --- Sortable Character Card Wrapper ---
interface CharacterCardProps {
    character: CharacterPrompt
    index: number
    isExpanded: boolean
    onToggleExpand: () => void
    onUpdate: (data: Partial<CharacterPrompt>) => void
    onRemove: () => void
    onToggleEnabled: () => void
    onDuplicate: () => void
    positionEnabled: boolean
}

function SortableCharacterCard(props: CharacterCardProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: props.character.id })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 1000 : undefined,
    }

    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
            <CharacterCard {...props} isDragging={isDragging} />
        </div>
    )
}

// --- Character Card Component ---
interface CharacterCardInnerProps extends CharacterCardProps {
    isDragging?: boolean
}

function CharacterCard({
    character,
    index,
    isExpanded,
    onToggleExpand,
    onUpdate,
    onRemove,
    onToggleEnabled,
    onDuplicate,
    positionEnabled,
    isDragging,
}: CharacterCardInnerProps) {
    const color = CHARACTER_COLORS[index % CHARACTER_COLORS.length]
    const { t } = useTranslation()
    const promptFontSize = useSettingsStore(state => state.promptFontSize)

    // 로컬 상태로 입력값 관리 (렉 방지)
    const [localPrompt, setLocalPrompt] = useState(character.prompt)
    const [localNegative, setLocalNegative] = useState(character.negative)

    // Silence valid unused variable warning by using it in a way that doesn't affect logic much or just omit if I can't.
    // Actually, let's just use it in the className to fix the error.
    const draggingClass = isDragging ? "opacity-50" : ""
    const [renameDialogOpen, setRenameDialogOpen] = useState(false)
    const [newName, setNewName] = useState(character.name || '')
    const debounceRef = useRef<NodeJS.Timeout | null>(null)

    // 외부에서 캐릭터가 변경되면 로컬 상태 동기화
    useEffect(() => {
        setLocalPrompt(character.prompt)
    }, [character.prompt])

    useEffect(() => {
        setLocalNegative(character.negative)
    }, [character.negative])

    // 디바운스된 저장
    const savePrompt = useCallback((value: string) => {
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => {
            onUpdate({ prompt: value })
        }, 500)
    }, [onUpdate])

    const saveNegative = useCallback((value: string) => {
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => {
            onUpdate({ negative: value })
        }, 500)
    }, [onUpdate])

    const handlePromptChange = useCallback((value: string) => {
        setLocalPrompt(value)
        savePrompt(value)
    }, [savePrompt])

    const handleNegativeChange = useCallback((value: string) => {
        setLocalNegative(value)
        saveNegative(value)
    }, [saveNegative])

    // 컴포넌트 언마운트 시 저장
    useEffect(() => {
        return () => {
            if (debounceRef.current) {
                clearTimeout(debounceRef.current)
            }
        }
    }, [])

    return (
        <>
            <ContextMenu>
                <ContextMenuTrigger asChild>
                    <div
                        className={cn(
                            "w-full rounded-xl border border-border/50 bg-background/60 transition-all duration-200 overflow-hidden",
                            !character.enabled && "opacity-50",
                            draggingClass
                        )}
                    >
                        {/* Card Header - 통일된 회색 디자인 */}
                        <div
                            className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors bg-muted/30"
                            onClick={onToggleExpand}
                        >
                            {/* 캐릭터 아이콘 */}
                            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                                <User className="h-4 w-4 text-primary" />
                            </div>

                            {/* 캐릭터 번호 뱃지 - 위치 활성화시 색상 표시 */}
                            <div
                                className={cn(
                                    "w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-semibold shrink-0 transition-colors",
                                    positionEnabled
                                        ? "text-white"
                                        : "bg-muted-foreground/20 text-muted-foreground"
                                )}
                                style={positionEnabled ? { backgroundColor: color } : undefined}
                            >
                                {index + 1}
                            </div>

                            <span className="flex-1 text-sm font-medium truncate">
                                {character.name
                                    || (character.prompt
                                        ? character.prompt.split(',')[0].trim().substring(0, 30)
                                        : t('characterPanel.unnamed', '캐릭터 ' + (index + 1)))}
                            </span>

                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 shrink-0"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    onToggleEnabled()
                                }}
                            >
                                {character.enabled ? (
                                    <Eye className="h-3.5 w-3.5 text-primary" />
                                ) : (
                                    <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                                )}
                            </Button>
                            <div className="shrink-0">
                                {isExpanded ? (
                                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                )}
                            </div>
                        </div>

                        {/* Expanded Content - 아래로 펼쳐짐 */}
                        {isExpanded && (
                            <div className="px-3 py-3 space-y-3 border-t border-border/30 bg-background/40 animate-in slide-in-from-top-2 duration-150">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                                        {t('characterPanel.prompt', '프롬프트')}
                                    </label>
                                    <AutocompleteTextarea
                                        value={localPrompt}
                                        onChange={(e) => handlePromptChange(e.target.value)}
                                        placeholder={t('characterPanel.promptPlaceholder', '캐릭터 외형 태그...')}
                                        className="h-[180px] text-sm resize-none"
                                        style={{ fontSize: `${promptFontSize}px` }}
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-destructive/70 whitespace-nowrap">
                                        {t('characterPanel.negative', '네거티브')}
                                    </label>
                                    <AutocompleteTextarea
                                        value={localNegative}
                                        onChange={(e) => handleNegativeChange(e.target.value)}
                                        placeholder={t('characterPanel.negativePlaceholder', '제외할 태그...')}
                                        className="h-[140px] text-sm border-destructive/20 resize-none"
                                        style={{ fontSize: `${promptFontSize}px` }}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                    <ContextMenuItem onClick={() => setRenameDialogOpen(true)}>
                        <Pencil className="h-4 w-4 mr-2" />
                        {t('characterPanel.rename', '이름 변경')}
                    </ContextMenuItem>
                    <ContextMenuItem onClick={onToggleEnabled}>
                        {character.enabled ? (
                            <>
                                <EyeOff className="h-4 w-4 mr-2" />
                                {t('characterPanel.disable', '비활성화')}
                            </>
                        ) : (
                            <>
                                <Eye className="h-4 w-4 mr-2" />
                                {t('characterPanel.enable', '활성화')}
                            </>
                        )}
                    </ContextMenuItem>
                    <ContextMenuItem onClick={onDuplicate}>
                        <Copy className="h-4 w-4 mr-2" />
                        {t('characterPanel.duplicate', '복제')}
                    </ContextMenuItem>
                    <ContextMenuItem onClick={onRemove} className="text-destructive">
                        <Trash2 className="h-4 w-4 mr-2" />
                        {t('common.delete', '삭제')}
                    </ContextMenuItem>
                </ContextMenuContent>
            </ContextMenu>

            {/* 이름 변경 다이얼로그 */}
            <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Pencil className="h-4 w-4" />
                            {t('characterPanel.rename', '이름 변경')}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-2">
                        <Input
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            placeholder={t('characterPanel.namePlaceholder', '캐릭터 이름 입력...')}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    onUpdate({ name: newName.trim() || undefined })
                                    setRenameDialogOpen(false)
                                }
                            }}
                            autoFocus
                        />
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => setRenameDialogOpen(false)}>
                                {t('common.cancel', '취소')}
                            </Button>
                            <Button
                                size="sm"
                                onClick={() => {
                                    onUpdate({ name: newName.trim() || undefined })
                                    setRenameDialogOpen(false)
                                }}
                            >
                                {t('common.save', '저장')}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    )
}

// --- Position Dialog ---
interface PositionDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    characters: CharacterPrompt[]
    onPositionChange: (id: string, x: number, y: number) => void
}

function PositionDialog({ open, onOpenChange, characters, onPositionChange }: PositionDialogProps) {
    const { t } = useTranslation()
    const gridRef = useRef<HTMLDivElement>(null)
    const [dragging, setDragging] = useState<string | null>(null)
    const [selectedId, setSelectedId] = useState<string | null>(null)

    const handleMouseDown = (e: MouseEvent, id: string) => {
        e.preventDefault()
        setDragging(id)
        setSelectedId(id)
    }

    const handleMouseMove = (e: MouseEvent) => {
        if (!dragging || !gridRef.current) return
        const rect = gridRef.current.getBoundingClientRect()
        const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
        const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
        onPositionChange(dragging, x, y)
    }

    const handleMouseUp = () => {
        setDragging(null)
    }

    useEffect(() => {
        const handleGlobalMouseUp = () => setDragging(null)
        window.addEventListener('mouseup', handleGlobalMouseUp)
        return () => window.removeEventListener('mouseup', handleGlobalMouseUp)
    }, [])

    const zones = [
        { label: '↖', x: 0.17, y: 0.15 },
        { label: '↑', x: 0.5, y: 0.15 },
        { label: '↗', x: 0.83, y: 0.15 },
        { label: '←', x: 0.17, y: 0.5 },
        { label: '●', x: 0.5, y: 0.5 },
        { label: '→', x: 0.83, y: 0.5 },
        { label: '↙', x: 0.17, y: 0.85 },
        { label: '↓', x: 0.5, y: 0.85 },
        { label: '↘', x: 0.83, y: 0.85 },
    ]

    const enabledCharacters = characters.filter(c => c.enabled)

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <MapPin className="h-5 w-5" />
                        {t('characterPanel.positionTitle', '캐릭터 위치 지정')}
                    </DialogTitle>
                </DialogHeader>

                <div
                    ref={gridRef}
                    className="relative w-full aspect-[3/4] bg-muted/30 rounded-lg border cursor-crosshair select-none overflow-hidden shadow-inner"
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                >
                    {/* Grid lines */}
                    <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none">
                        {[...Array(9)].map((_, i) => (
                            <div key={i} className="border border-border/20" />
                        ))}
                    </div>

                    {/* Zone labels */}
                    {zones.map((zone, i) => (
                        <div
                            key={i}
                            className="absolute text-lg text-muted-foreground/30 pointer-events-none select-none"
                            style={{
                                left: `${zone.x * 100}%`,
                                top: `${zone.y * 100}%`,
                                transform: 'translate(-50%, -50%)'
                            }}
                        >
                            {zone.label}
                        </div>
                    ))}

                    {/* Character markers */}
                    {enabledCharacters.map((char) => {
                        const colorIndex = characters.findIndex(c => c.id === char.id)
                        return (
                            <div
                                key={char.id}
                                className={cn(
                                    "absolute w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold cursor-grab active:cursor-grabbing shadow-lg transition-transform",
                                    selectedId === char.id && "ring-2 ring-white ring-offset-2 ring-offset-black/50 scale-110 z-10",
                                    dragging === char.id && "scale-125 z-20"
                                )}
                                style={{
                                    left: `${char.position.x * 100}%`,
                                    top: `${char.position.y * 100}%`,
                                    transform: 'translate(-50%, -50%)',
                                    backgroundColor: CHARACTER_COLORS[colorIndex % CHARACTER_COLORS.length],
                                }}
                                onMouseDown={(e) => handleMouseDown(e, char.id)}
                            >
                                {colorIndex + 1}
                            </div>
                        )
                    })}

                    {/* Empty state */}
                    {enabledCharacters.length === 0 && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="text-muted-foreground text-sm text-center">
                                <Users className="w-8 h-8 opacity-30 mx-auto mb-2" />
                                <p>{t('characterPanel.noActiveCharacters', '활성화된 캐릭터가 없습니다')}</p>
                            </div>
                        </div>
                    )}
                </div>

                <p className="text-xs text-muted-foreground text-center">
                    {t('characterPanel.positionHelp', '캐릭터를 드래그하여 위치를 지정하세요')}
                </p>
            </DialogContent>
        </Dialog>
    )
}
