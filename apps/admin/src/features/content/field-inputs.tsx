import type { FieldDefinition } from '@nexora/shared';
import { Button, Checkbox, Field, Input, Label, NativeSelect, Textarea } from '@nexora/ui';
import { FileImage, X } from 'lucide-react';
import { useState } from 'react';
import { MediaPickerDialog } from '../media/media-picker-dialog';

type Values = Record<string, unknown>;

function MediaFieldInput({
  value,
  label,
  onChange,
  disabled,
}: {
  value: string | null;
  label: string;
  onChange: (value: string | null, name?: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex min-w-0 items-center gap-2 text-sm">
        <FileImage className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate">{value ? (name ?? 'Selected file') : 'No file selected'}</span>
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
        }}
      >
        Choose file
      </Button>
      {value && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={`Clear ${label}`}
          disabled={disabled}
          onClick={() => {
            onChange(null);
          }}
        >
          <X aria-hidden="true" />
        </Button>
      )}
      <MediaPickerDialog
        open={open}
        onOpenChange={setOpen}
        title={`Choose a file for ${label}`}
        onSelect={(item) => {
          setName(item.title);
          onChange(item.id);
        }}
      />
    </div>
  );
}

/** Inputs for a content type's custom fields; values are validated with the shared schema on save. */
export function FieldInputs({
  fields,
  values,
  errors,
  onChange,
  disabled,
}: {
  fields: readonly FieldDefinition[];
  values: Values;
  errors: Readonly<Record<string, string>>;
  onChange: (key: string, value: unknown) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {fields.map((field) => {
        const value = values[field.key];
        const error = errors[`fields.${field.key}`];
        const label = field.required ? `${field.label} *` : field.label;
        const description = field.description || undefined;
        if (field.type === 'boolean') {
          return (
            <div key={field.key} className="flex flex-col gap-1">
              <Label className="flex items-center gap-2 font-normal">
                <Checkbox
                  checked={value === true}
                  disabled={disabled}
                  onChange={(event) => {
                    onChange(field.key, event.target.checked);
                  }}
                />
                {field.label}
              </Label>
              {description && <p className="text-xs text-muted-foreground">{description}</p>}
              {error && <p className="text-xs font-medium text-danger">{error}</p>}
            </div>
          );
        }
        return (
          <Field key={field.key} label={label} description={description} error={error}>
            {(control) => {
              const text =
                typeof value === 'string' || typeof value === 'number' ? String(value) : '';
              switch (field.type) {
                case 'textarea':
                  return (
                    <Textarea
                      {...control}
                      rows={4}
                      disabled={disabled}
                      maxLength={field.maxLength}
                      value={text}
                      onChange={(event) => {
                        onChange(field.key, event.target.value);
                      }}
                    />
                  );
                case 'select':
                  return (
                    <NativeSelect
                      {...control}
                      disabled={disabled}
                      value={text}
                      onChange={(event) => {
                        onChange(field.key, event.target.value || null);
                      }}
                    >
                      <option value="">—</option>
                      {field.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </NativeSelect>
                  );
                case 'number':
                  return (
                    <Input
                      {...control}
                      type="number"
                      inputMode="decimal"
                      disabled={disabled}
                      step={field.integer ? 1 : 'any'}
                      {...(field.min !== null ? { min: field.min } : {})}
                      {...(field.max !== null ? { max: field.max } : {})}
                      value={text}
                      onChange={(event) => {
                        onChange(
                          field.key,
                          event.target.value === '' ? null : Number(event.target.value),
                        );
                      }}
                    />
                  );
                case 'media':
                  return (
                    <MediaFieldInput
                      value={typeof value === 'string' ? value : null}
                      label={field.label}
                      disabled={disabled}
                      onChange={(id) => {
                        onChange(field.key, id);
                      }}
                    />
                  );
                default:
                  return (
                    <Input
                      {...control}
                      type={
                        field.type === 'date'
                          ? 'date'
                          : field.type === 'url'
                            ? 'url'
                            : field.type === 'email'
                              ? 'email'
                              : 'text'
                      }
                      disabled={disabled}
                      {...(field.type === 'text' ? { maxLength: field.maxLength } : {})}
                      value={text}
                      onChange={(event) => {
                        onChange(field.key, event.target.value);
                      }}
                    />
                  );
              }
            }}
          </Field>
        );
      })}
    </div>
  );
}
