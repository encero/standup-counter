import { useState } from 'react';
import { Pin, Plus, X, ArrowRight, Check } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type { SyncNote } from '@/types/standup';

interface SyncNotesPanelProps {
  notes: SyncNote[];
  onAdd: (text: string) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Live "parking lot" panel shown in the main counter view. Lets anyone quickly
 * jot a topic to sync on after standup ends. Notes sync across all clients.
 */
export function SyncNotesPanel({ notes, onAdd, onRemove, disabled, className }: SyncNotesPanelProps) {
  const [text, setText] = useState('');

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    // Clearing the value keeps focus on the input, so several notes can be
    // captured back-to-back without re-clicking.
    setText('');
  };

  // newest first for quick scanning
  const ordered = [...notes].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <Card size="sm" className={className}>
      <CardContent className="space-y-2">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); submit(); }}
        >
          <Pin className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Sync after standup — add a topic…"
            disabled={disabled}
            maxLength={500}
            aria-label="Add a sync topic"
          />
          {notes.length > 0 && (
            <Badge variant="secondary" className="shrink-0">{notes.length}</Badge>
          )}
          <Button
            type="submit"
            size="icon"
            variant="default"
            disabled={disabled || !text.trim()}
            title="Add note"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </form>

        {ordered.length > 0 && (
          <ul className="space-y-1">
            {ordered.map((note) => (
              <li
                key={note.id}
                className="group flex items-start gap-2 rounded-md bg-muted/50 px-2.5 py-1 text-sm"
              >
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                <span className="flex-1 break-words whitespace-pre-wrap leading-snug">{note.text}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="-mr-1 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => onRemove(note.id)}
                  title="Remove note"
                  aria-label="Remove note"
                >
                  <X className="h-3 w-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

interface SyncNotesDialogProps {
  open: boolean;
  notes: SyncNote[];
  onContinue: () => void;
}

/**
 * Review dialog shown when a standup ends and there are sync notes. Lists the
 * parking-lot items; dismissing it (any way) always advances to the summary.
 */
export function SyncNotesDialog({ open, notes, onContinue }: SyncNotesDialogProps) {
  // Moderator marks topics as discussed; completed ones collapse to the bottom.
  // New standups carry fresh note ids, so stale ids here are harmless.
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setCompleted(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const ordered = [...notes].sort((a, b) => a.createdAt - b.createdAt);
  const active = ordered.filter(n => !completed.has(n.id));
  const done = ordered.filter(n => completed.has(n.id));
  const allDone = ordered.length > 0 && active.length === 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onContinue(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pin className="h-4 w-4 text-amber-500" />
            Time to sync
          </DialogTitle>
          <DialogDescription>
            {allDone
              ? `All ${ordered.length} topic${ordered.length === 1 ? '' : 's'} discussed — nice work.`
              : `${done.length}/${ordered.length} discussed · tap a topic to collapse it once covered.`}
          </DialogDescription>
        </DialogHeader>

        <ul className="max-h-[50vh] space-y-1.5 overflow-y-auto py-1">
          {active.map((note, i) => (
            <li key={note.id}>
              <button
                type="button"
                onClick={() => toggle(note.id)}
                className="group flex w-full items-start gap-3 rounded-lg border bg-muted/40 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-xs font-medium text-amber-600 dark:text-amber-400">
                  {i + 1}
                </span>
                <span className="flex-1 break-words whitespace-pre-wrap leading-snug">{note.text}</span>
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            </li>
          ))}
          {done.map((note) => (
            <li key={note.id}>
              <button
                type="button"
                onClick={() => toggle(note.id)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left text-sm opacity-60 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:opacity-100"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-500/15 text-green-600 dark:text-green-400">
                  <Check className="h-3 w-3" />
                </span>
                <span className="flex-1 break-words whitespace-pre-wrap leading-snug line-through decoration-muted-foreground/50">{note.text}</span>
              </button>
            </li>
          ))}
        </ul>

        <DialogFooter>
          <Button onClick={onContinue}>
            View summary
            <ArrowRight className="h-4 w-4" data-icon="inline-end" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
