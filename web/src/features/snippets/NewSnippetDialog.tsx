import { useCallback } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useUiStore } from '@/stores/uiStore';

// Form is intentionally non-functional in v2.14.0. The follow-up CRUD ticket
// wires up create/update/delete against Supabase. The dialog ships now so the
// UI surface can be reviewed end-to-end.
export function NewSnippetDialog() {
  const open = useUiStore((s) => s.newSnippetOpen);
  const openDialog = useUiStore((s) => s.openNewSnippet);
  const closeDialog = useUiStore((s) => s.closeNewSnippet);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) openDialog();
      else closeDialog();
    },
    [openDialog, closeDialog],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="primary">
          <Plus className="h-4 w-4" />
          New snippet
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create snippet</DialogTitle>
          <DialogDescription>
            This editor lands in the next release. The form is shown for layout review only.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <label htmlFor="snippet-name" className="text-xs font-medium text-ink-muted">
              Name
            </label>
            <Input id="snippet-name" placeholder="Quote — English" disabled />
          </div>
          <div className="grid gap-2">
            <label htmlFor="snippet-trigger" className="text-xs font-medium text-ink-muted">
              Trigger
            </label>
            <Input id="snippet-trigger" placeholder="quoteEN" disabled />
          </div>
          <div className="grid gap-2">
            <label htmlFor="snippet-content" className="text-xs font-medium text-ink-muted">
              Content
            </label>
            <textarea
              id="snippet-content"
              rows={4}
              disabled
              className="w-full resize-none rounded-[12px] border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
              placeholder="Dear {guest}, …"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => closeDialog()}>
            Cancel
          </Button>
          <Button variant="primary" disabled title="Available in next release">
            Save snippet
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
