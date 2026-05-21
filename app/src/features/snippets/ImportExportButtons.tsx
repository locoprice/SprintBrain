import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSnippetStore } from '@/stores/snippetStore';
import { exportSnippets, parseImportFile } from '@/lib/snippetIo';

export type ImportResult =
  | { ok: true; count: number; skipped: number }
  | { ok: false; message: string };

interface ImportExportButtonsProps {
  onResult: (result: ImportResult) => void;
}

export function ImportExportButtons({ onResult }: ImportExportButtonsProps) {
  const snippets = useSnippetStore((s) => s.snippets);
  const importSnippets = useSnippetStore((s) => s.importSnippets);

  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  function handleExport() {
    exportSnippets(snippets);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset so the same file can be re-selected after a failed import.
    e.target.value = '';

    setImporting(true);
    try {
      const { valid, skipped: parseSkipped } = await parseImportFile(file);
      if (valid.length === 0) {
        onResult({ ok: false, message: 'No importable snippets found in the file.' });
        return;
      }
      const { imported, failed } = await importSnippets(valid);
      onResult({ ok: true, count: imported, skipped: parseSkipped + failed });
    } catch (err) {
      onResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Import failed.',
      });
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="md"
        onClick={() => fileRef.current?.click()}
        disabled={importing}
        title="Import snippets from a JSON file (SprintBrain or Text Blaze format)"
      >
        <Upload className="h-4 w-4" />
        {importing ? 'Importing…' : 'Import'}
      </Button>

      <Button
        variant="ghost"
        size="md"
        onClick={handleExport}
        disabled={snippets.length === 0}
        title="Export all snippets as a JSON file"
      >
        <Download className="h-4 w-4" />
        Export
      </Button>

      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        onChange={handleFileChange}
      />
    </>
  );
}
