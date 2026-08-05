import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import '../App.css'
import Header from '../components/Header'
import { Scheduler } from '../components/scheduler'
import type { ClassTypeOption, InstructorOption, SchedulerEvent, SchedulerHandle, SchedulerView } from '../components/scheduler'
import { useHistoryState } from '../hooks/useHistoryState'
import { allocate } from '../lib/allocator/allocate'
import { sampleClassRequests, sampleClasses, sampleInstructors, sampleRooms } from '../lib/allocator/sampleRoster'
import { parseRosterWorkbook } from '../lib/roster/parseRoster'
import { exportScheduleToXlsx } from '../lib/schedule/exportSchedule'
import type { ScheduleStateData } from '../lib/schedule/saveState'
import { exportScheduleState, parseScheduleState } from '../lib/schedule/saveState'

// Same palette eventColor.ts falls back to for unregistered types — reused
// here so the drawer's initial "Class Types" list matches what auto-coloring
// would have picked anyway.
const CLASS_TYPE_PALETTE = ['#4f6df5', '#4f9d6c', '#c98a4b', '#c76f94', '#4a9aa8', '#8778c9', '#c26b6b', '#3f9d90', '#c2a23f', '#7b7ed6']

const INITIAL_CLASS_TYPES: ClassTypeOption[] = Array.from(new Set(sampleClasses.map((c) => c.type).filter((t): t is string => Boolean(t)))).map(
  (name, i) => ({ name, color: CLASS_TYPE_PALETTE[i % CLASS_TYPE_PALETTE.length] }),
)

const instructorOptions: InstructorOption[] = sampleInstructors.map((instructor) => ({
  id: instructor.id,
  name: instructor.name,
  availability: instructor.availability,
}))

/** Monday of the calendar week containing `date`, at midnight. */
function mostRecentMonday(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const diffFromMonday = (d.getDay() + 6) % 7 // getDay(): 0 = Sunday ... 6 = Saturday
  d.setDate(d.getDate() - diffFromMonday)
  return d
}

// The 20-instructor/60-request fixture's availability is keyed to real
// weekday names (Monday..Friday), not "today" — so events are generated
// starting from the Monday of the current week (guaranteeing today falls
// inside the range) across a 4-month window, matching the real-world
// scheduling horizon this is meant for. allocate()'s per-request weekly cap
// (see allocate.ts) is what makes this recur roughly once (or twice) a week
// across the whole window instead of piling up at the very start.
const scheduleStart = mostRecentMonday(new Date())
const scheduleEnd = new Date(scheduleStart)
scheduleEnd.setMonth(scheduleStart.getMonth() + 4)

const initialEvents: SchedulerEvent[] = allocate(
  sampleClassRequests,
  sampleRooms,
  sampleClasses,
  sampleInstructors,
  scheduleStart,
  scheduleEnd,
)

const INITIAL_DOCUMENT: ScheduleStateData = {
  events: initialEvents,
  resources: sampleRooms,
  classTypes: INITIAL_CLASS_TYPES,
  instructors: instructorOptions,
}

export default function SchedulerPage() {
  // events/resources/classTypes/instructors are one combined "document" so a
  // single Undo/Redo history covers every kind of edit uniformly, not just
  // event moves — see useHistoryState's own docs for why it's one object
  // instead of four separate undo stacks.
  const { state: doc, set: setDoc, undo, redo, reset: resetDoc, canUndo, canRedo } = useHistoryState<ScheduleStateData>(INITIAL_DOCUMENT)
  const { events, resources, classTypes, instructors } = doc

  const schedulerRef = useRef<SchedulerHandle>(null)
  const rosterFileInputRef = useRef<HTMLInputElement>(null)
  const saveFileInputRef = useRef<HTMLInputElement>(null)

  async function handleRosterFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const buffer = await file.arrayBuffer()
    const parsedInstructors = parseRosterWorkbook(buffer)
    console.log('parsed roster', parsedInstructors)
  }

  async function handleSaveFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const state = parseScheduleState(await file.text())
      // Validate before asking — an invalid file should show the error below,
      // not a confirmation prompt for a load that was never going to happen.
      if (!window.confirm('Loading this file will replace your current schedule. Continue?')) return
      // A loaded file starts its own fresh history — undoing "back into" the
      // previously-open schedule wouldn't make sense.
      resetDoc(state)
    } catch (error) {
      console.error('Failed to load schedule save', error)
      alert('This file does not look like a valid schedule save.')
    }
  }

  // Mirrored from the scheduler via onViewChange/onTitleChange/onDrawerOpenChange
  // so the app-level Header (which owns the actual controls) can render them —
  // the scheduler's own toolbar is hidden via `hideToolbar` below.
  const [view, setView] = useState<SchedulerView>('week')
  const [title, setTitle] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Ctrl/Cmd+Z to undo, Ctrl/Cmd+Shift+Z (or Ctrl+Y) to redo — skipped while
  // focused in a text input so the browser's native field-level undo (e.g.
  // while typing a new event's class name) isn't hijacked by this.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isMod = e.ctrlKey || e.metaKey
      if (!isMod) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return

      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo])

  return (
    <>
      <input
        type="file"
        accept=".xlsx"
        ref={rosterFileInputRef}
        onChange={handleRosterFileSelected}
        style={{ display: 'none' }}
      />
      <input
        type="file"
        accept=".json"
        ref={saveFileInputRef}
        onChange={handleSaveFileSelected}
        style={{ display: 'none' }}
      />
      <Header
        drawerOpen={drawerOpen}
        onToggleDrawer={() => schedulerRef.current?.toggleDrawer()}
        title={title}
        onToday={() => schedulerRef.current?.gotoToday()}
        onPrev={() => schedulerRef.current?.gotoPrev()}
        onNext={() => schedulerRef.current?.gotoNext()}
        view={view}
        onViewChange={(v) => schedulerRef.current?.setView(v)}
        canUndo={canUndo}
        onUndo={undo}
        canRedo={canRedo}
        onRedo={redo}
      />
      <div className="app-layout">
        <div className="main-content">
          <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
            <Scheduler
              ref={schedulerRef}
              hideToolbar
              resources={resources}
              events={events}
              instructors={instructors}
              classTypes={classTypes}
              dayStartHour={8}
              dayEndHour={20}
              canUndo={canUndo}
              onUndo={undo}
              canRedo={canRedo}
              onRedo={redo}
              onEventMove={(event, newResourceId, newStart, newEnd) => {
                console.log('onEventMove', event.id, newResourceId, newStart, newEnd)
                setDoc((prev) => ({
                  ...prev,
                  events: prev.events.map((e) => (e.id === event.id ? { ...e, resourceId: newResourceId, start: newStart, end: newEnd } : e)),
                }))
              }}
              onEventResizeEnd={(event, newStart, newEnd, edge) => {
                console.log('onEventResizeEnd', event.id, newStart, newEnd, edge)
                setDoc((prev) => ({
                  ...prev,
                  events: prev.events.map((e) => (e.id === event.id ? { ...e, start: newStart, end: newEnd } : e)),
                }))
              }}
              onEventEdit={(event, updates) => {
                console.log('onEventEdit', event.id, updates)
                setDoc((prev) => ({
                  ...prev,
                  events: prev.events.map((e) => (e.id === event.id ? { ...e, ...updates } : e)),
                }))
              }}
              onEventDelete={(event) => {
                console.log('onEventDelete', event.id)
                setDoc((prev) => ({ ...prev, events: prev.events.filter((e) => e.id !== event.id) }))
              }}
              onCreateEvent={(draft) => {
                console.log('onCreateEvent', draft)
                setDoc((prev) => ({ ...prev, events: [...prev.events, { ...draft, id: crypto.randomUUID() }] }))
              }}
              onEventClick={(event) => console.log('onEventClick', event.id)}
              onEventDoubleClick={(event) => console.log('onEventDoubleClick', event.id)}
              onDateClick={(date, resourceId) => console.log('onDateClick', date, resourceId)}
              onSelection={(resourceId, start, end) => console.log('onSelection', resourceId, start, end)}
              onViewChange={setView}
              onTitleChange={setTitle}
              onDrawerOpenChange={setDrawerOpen}
              onDateChange={(range) => console.log('onDateChange', range)}
              onImport={() => rosterFileInputRef.current?.click()}
              onLoad={() => saveFileInputRef.current?.click()}
              onSave={() => void exportScheduleState(doc)}
              onExport={() => void exportScheduleToXlsx(events, resources)}
              onAddResource={(resource) => setDoc((prev) => ({ ...prev, resources: [...prev.resources, resource] }))}
              onAddClassType={(classType) => setDoc((prev) => ({ ...prev, classTypes: [...prev.classTypes, classType] }))}
              onClassTypeColorChange={(name, color) =>
                setDoc((prev) => ({
                  ...prev,
                  classTypes: prev.classTypes.map((ct) => (ct.name === name ? { ...ct, color } : ct)),
                }))
              }
              onEditInstructor={(instructorId, updates) => {
                console.log('onEditInstructor', instructorId, updates)
                setDoc((prev) => ({
                  ...prev,
                  instructors: prev.instructors.map((i) => (i.id === instructorId ? { ...i, ...updates } : i)),
                  // instructorName on events is a denormalized copy — a rename needs to
                  // cascade to their existing events, or those would keep showing the old name.
                  events: updates.name
                    ? prev.events.map((e) => (e.instructorId === instructorId ? { ...e, instructorName: updates.name! } : e))
                    : prev.events,
                }))
              }}
            />
          </div>
        </div>
      </div>
    </>
  )
}
