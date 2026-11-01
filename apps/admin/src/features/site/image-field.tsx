import { Button, Label } from '@nexora/ui';
import { ImageIcon, X } from 'lucide-react';
import { useId, useState } from 'react';
import { MediaPickerDialog } from '../media/media-picker-dialog';

export interface ImagePreview {
  readonly id: string;
  readonly thumbnailUrl: string | null;
  readonly altText: string;
}

interface ImageFieldProps {
  label: string;
  description?: string;
  value: ImagePreview | null;
  onChange: (value: ImagePreview | null) => void;
  error?: string | undefined;
}

/** An image chosen from the media library (stored as its id), with a preview and a remove button. */
export function ImageField({ label, description, value, onChange, error }: ImageFieldProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5" role="group" aria-labelledby={`${id}-label`}>
      <Label id={`${id}-label`}>{label}</Label>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex size-20 items-center justify-center overflow-hidden rounded-md border bg-muted">
          {value?.thumbnailUrl ? (
            <img
              src={value.thumbnailUrl}
              alt={value.altText}
              className="size-full object-contain"
            />
          ) : (
            <ImageIcon className="size-6 text-muted-foreground" aria-hidden="true" />
          )}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setOpen(true);
            }}
          >
            {value ? 'Change image' : 'Choose image'}
          </Button>
          {value && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange(null);
              }}
            >
              <X aria-hidden="true" />
              Remove
            </Button>
          )}
        </div>
      </div>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      {error && <p className="text-xs font-medium text-danger">{error}</p>}
      <MediaPickerDialog
        open={open}
        onOpenChange={setOpen}
        kind="image"
        title={label}
        onSelect={(item) => {
          onChange({
            id: item.id,
            thumbnailUrl: item.thumbnailUrl ?? item.url,
            altText: item.altText,
          });
        }}
      />
    </div>
  );
}
