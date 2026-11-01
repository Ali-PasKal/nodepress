import {
  shortcodeRegistry,
  shortcodeTexts,
  widgetPropsSchemas,
  type Breakpoint,
  type BuilderColumn,
  type BuilderSection,
  type BuilderWidget,
  type MediaItem,
  type RichTextDocument,
  type StyleValues,
} from '@nexora/shared';
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Field,
  Input,
  Label,
  NativeSelect,
  Textarea,
} from '@nexora/ui';
import { ArrowDown, ArrowUp, Copy, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { MediaPickerDialog } from '../media/media-picker-dialog';
import { RichTextEditor } from '../content/rich-text-editor';
import { shortcodeProblems, videoIdFrom, widgetLabel } from './labels';
import {
  duplicateElement,
  effectiveStyle,
  findElement,
  moveElement,
  removeElement,
  setColumnCount,
  updateElement,
  updateStyles,
  withoutKey,
} from './document-ops';
import { useBuilderStore } from './store';

const DEVICE_LABELS: Record<Breakpoint, string> = {
  desktop: 'Desktop',
  tablet: 'Tablet',
  mobile: 'Mobile',
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b px-4 py-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function NumberInput({
  label,
  value,
  placeholder,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number | undefined;
  placeholder?: number | undefined;
  min: number;
  max: number;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <Field label={label}>
      {(control) => (
        <Input
          {...control}
          type="number"
          min={min}
          max={max}
          value={value ?? ''}
          placeholder={placeholder === undefined ? '' : String(placeholder)}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw === '') {
              onChange(undefined);
              return;
            }
            const number = Math.round(Number(raw));
            if (Number.isFinite(number)) onChange(Math.max(min, Math.min(max, number)));
          }}
        />
      )}
    </Field>
  );
}

function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <Field label={label}>
      {(control) => (
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label={`${label} picker`}
            className="h-9 w-10 shrink-0 cursor-pointer rounded border bg-surface p-0.5"
            value={value ?? '#000000'}
            onChange={(event) => {
              onChange(event.target.value);
            }}
          />
          <Input
            {...control}
            className="font-mono"
            value={value ?? ''}
            placeholder="none"
            maxLength={7}
            onChange={(event) => {
              const next = event.target.value.trim().toLowerCase();
              onChange(next === '' ? undefined : next);
            }}
          />
        </div>
      )}
    </Field>
  );
}

function StyleForm({ id, styles }: { id: string; styles: BuilderWidget['styles'] }) {
  const device = useBuilderStore((state) => state.device);
  const apply = useBuilderStore((state) => state.apply);
  const own = styles[device] ?? {};
  const inherited = <Key extends keyof StyleValues>(key: Key) =>
    device === 'desktop'
      ? undefined
      : effectiveStyle(styles, device === 'mobile' ? 'tablet' : 'desktop', key);
  const set = (patch: Partial<StyleValues>) => {
    apply(
      (document) => updateStyles(document, id, device, patch),
      undefined,
      `style:${id}:${Object.keys(patch).join()}`,
    );
  };
  const number = (
    key:
      | 'paddingTop'
      | 'paddingEnd'
      | 'paddingBottom'
      | 'paddingStart'
      | 'marginTop'
      | 'marginBottom'
      | 'fontSize'
      | 'borderRadius'
      | 'maxWidth'
      | 'minHeight',
    label: string,
    min: number,
    max: number,
  ) => (
    <NumberInput
      key={key}
      label={label}
      value={own[key]}
      placeholder={inherited(key)}
      min={min}
      max={max}
      onChange={(value) => {
        set({ [key]: value });
      }}
    />
  );
  return (
    <Section title={`Style — ${DEVICE_LABELS[device]}`}>
      {device !== 'desktop' ? (
        <p className="text-xs text-muted-foreground">
          Values set here apply to {device === 'tablet' ? 'tablets and phones' : 'phones'}; empty
          fields inherit the larger screen.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        {number('paddingTop', 'Padding top', 0, 400)}
        {number('paddingBottom', 'Padding bottom', 0, 400)}
        {number('paddingStart', 'Padding start', 0, 400)}
        {number('paddingEnd', 'Padding end', 0, 400)}
        {number('marginTop', 'Margin top', -200, 400)}
        {number('marginBottom', 'Margin bottom', -200, 400)}
        {number('fontSize', 'Font size', 8, 160)}
        {number('borderRadius', 'Corner radius', 0, 200)}
        {number('maxWidth', 'Max width', 100, 2400)}
        {number('minHeight', 'Min height', 0, 2000)}
      </div>
      <ColorInput
        label="Background colour"
        value={own.backgroundColor}
        onChange={(value) => {
          set({ backgroundColor: value });
        }}
      />
      <ColorInput
        label="Text colour"
        value={own.textColor}
        onChange={(value) => {
          set({ textColor: value });
        }}
      />
      <Field label="Text alignment">
        {(control) => (
          <NativeSelect
            {...control}
            value={own.textAlign ?? ''}
            onChange={(event) => {
              set({ textAlign: (event.target.value || undefined) as StyleValues['textAlign'] });
            }}
          >
            <option value="">
              {inherited('textAlign') ? `Inherit (${String(inherited('textAlign'))})` : 'Default'}
            </option>
            <option value="start">Start</option>
            <option value="center">Center</option>
            <option value="end">End</option>
            <option value="justify">Justify</option>
          </NativeSelect>
        )}
      </Field>
      <Label className="flex items-center gap-2 font-normal">
        <Checkbox
          checked={own.hidden === true}
          onChange={(event) => {
            set({ hidden: event.target.checked ? true : undefined });
          }}
        />
        Hide on {DEVICE_LABELS[device].toLowerCase()}
        {device === 'desktop' ? ' (and smaller screens unless shown there)' : ''}
      </Label>
    </Section>
  );
}

function ImageProps({
  widget,
  update,
  onMedia,
}: {
  widget: Extract<BuilderWidget, { widget: 'image' }>;
  update: (patch: Record<string, unknown>) => void;
  onMedia: (item: MediaItem) => void;
}) {
  const [picking, setPicking] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setPicking(true);
        }}
      >
        {widget.props.mediaId ? 'Replace image' : 'Choose image'}
      </Button>
      <MediaPickerDialog
        open={picking}
        onOpenChange={setPicking}
        kind="image"
        onSelect={(item) => {
          onMedia(item);
          update({ mediaId: item.id });
        }}
      />
      <TextProp
        label="Alternative text (empty: the media library's)"
        value={widget.props.alt}
        max={500}
        onChange={(alt) => {
          update({ alt });
        }}
      />
      <TextProp
        label="Caption"
        value={widget.props.caption}
        max={500}
        onChange={(caption) => {
          update({ caption });
        }}
      />
      <TextProp
        label="Link (optional)"
        value={widget.props.link ?? ''}
        max={2048}
        onChange={(link) => {
          update({ link: link === '' ? null : link });
        }}
      />
      <SelectProp
        label="Width"
        value={widget.props.width}
        options={[
          ['full', 'Full width'],
          ['auto', 'Natural size'],
        ]}
        onChange={(width) => {
          update({ width });
        }}
      />
    </>
  );
}

function TextProp({
  label,
  value,
  max,
  onChange,
  multiline = false,
}: {
  label: string;
  value: string;
  max: number;
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  return (
    <Field label={label}>
      {(control) =>
        multiline ? (
          <Textarea
            {...control}
            value={value}
            maxLength={max}
            rows={6}
            className="font-mono text-xs"
            onChange={(event) => {
              onChange(event.target.value);
            }}
          />
        ) : (
          <Input
            {...control}
            value={value}
            maxLength={max}
            onChange={(event) => {
              onChange(event.target.value);
            }}
          />
        )
      }
    </Field>
  );
}

function SelectProp<Value extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value;
  options: readonly (readonly [Value, string])[];
  onChange: (value: Value) => void;
}) {
  return (
    <Field label={label}>
      {(control) => (
        <NativeSelect
          {...control}
          value={String(value)}
          onChange={(event) => {
            const option = options.find(([candidate]) => String(candidate) === event.target.value);
            if (option) onChange(option[0]);
          }}
        >
          {options.map(([optionValue, optionLabel]) => (
            <option key={String(optionValue)} value={String(optionValue)}>
              {optionLabel}
            </option>
          ))}
        </NativeSelect>
      )}
    </Field>
  );
}

function BoolProp({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Label className="flex items-center gap-2 font-normal">
      <Checkbox
        checked={value}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      {label}
    </Label>
  );
}

function WidgetProps({
  widget,
  canEmbedHtml,
  onMedia,
}: {
  widget: BuilderWidget;
  canEmbedHtml: boolean;
  onMedia: (item: MediaItem) => void;
}) {
  const apply = useBuilderStore((state) => state.apply);
  const update = (patch: Record<string, unknown>) => {
    apply(
      (document) =>
        updateElement<BuilderWidget>(
          document,
          widget.id,
          (node) => ({ ...node, props: { ...node.props, ...patch } }) as BuilderWidget,
        ),
      undefined,
      `props:${widget.id}:${Object.keys(patch).join()}`,
    );
  };
  const check = widgetPropsSchemas[widget.widget].safeParse(widget.props);
  const issues = check.success ? [] : check.error.issues.map((issue) => issue.message);
  let fields: ReactNode;
  switch (widget.widget) {
    case 'heading':
      fields = (
        <>
          <TextProp
            label="Text"
            value={widget.props.text}
            max={300}
            onChange={(text) => {
              update({ text });
            }}
          />
          <SelectProp
            label="Level"
            value={widget.props.level}
            options={[1, 2, 3, 4, 5, 6].map(
              (level) => [level, `Heading ${String(level)}`] as const,
            )}
            onChange={(level) => {
              update({ level });
            }}
          />
          <TextProp
            label="Link (optional)"
            value={widget.props.link ?? ''}
            max={2048}
            onChange={(link) => {
              update({ link: link === '' ? null : link });
            }}
          />
        </>
      );
      break;
    case 'text': {
      const problems = shortcodeTexts(widget.props.content, null).flatMap(shortcodeProblems);
      fields = (
        <>
          <RichTextEditor
            key={widget.id}
            label="Text"
            value={widget.props.content}
            onChange={(content: RichTextDocument) => {
              update({ content });
            }}
          />
          <p className="text-xs text-muted-foreground">
            Shortcodes such as [year] or [recent_posts count=3] work in text.
          </p>
          {problems.map((problem) => (
            <p key={problem} className="text-xs font-medium text-warning">
              {problem} It will appear as plain text.
            </p>
          ))}
        </>
      );
      break;
    }
    case 'image':
      fields = <ImageProps widget={widget} update={update} onMedia={onMedia} />;
      break;
    case 'button':
      fields = (
        <>
          <TextProp
            label="Label"
            value={widget.props.label}
            max={100}
            onChange={(label) => {
              update({ label });
            }}
          />
          <TextProp
            label="Link"
            value={widget.props.url}
            max={2048}
            onChange={(url) => {
              update({ url });
            }}
          />
          <SelectProp
            label="Style"
            value={widget.props.variant}
            options={[
              ['primary', 'Primary'],
              ['secondary', 'Secondary'],
              ['outline', 'Outline'],
            ]}
            onChange={(variant) => {
              update({ variant });
            }}
          />
          <SelectProp
            label="Size"
            value={widget.props.size}
            options={[
              ['sm', 'Small'],
              ['md', 'Medium'],
              ['lg', 'Large'],
            ]}
            onChange={(size) => {
              update({ size });
            }}
          />
          <BoolProp
            label="Open in a new tab"
            value={widget.props.openInNewTab}
            onChange={(openInNewTab) => {
              update({ openInNewTab });
            }}
          />
          <BoolProp
            label="Full width"
            value={widget.props.fullWidth}
            onChange={(fullWidth) => {
              update({ fullWidth });
            }}
          />
        </>
      );
      break;
    case 'spacer':
      fields = (
        <NumberInput
          label="Height (px)"
          value={widget.props.height}
          min={0}
          max={600}
          onChange={(height) => {
            update({ height: height ?? 0 });
          }}
        />
      );
      break;
    case 'divider':
      fields = (
        <>
          <SelectProp
            label="Line"
            value={widget.props.style}
            options={[
              ['solid', 'Solid'],
              ['dashed', 'Dashed'],
              ['dotted', 'Dotted'],
            ]}
            onChange={(style) => {
              update({ style });
            }}
          />
          <NumberInput
            label="Thickness (px)"
            value={widget.props.thickness}
            min={1}
            max={20}
            onChange={(thickness) => {
              update({ thickness: thickness ?? 1 });
            }}
          />
          <NumberInput
            label="Width (%)"
            value={widget.props.width}
            min={10}
            max={100}
            onChange={(width) => {
              update({ width: width ?? 100 });
            }}
          />
          <ColorInput
            label="Colour"
            value={widget.props.color}
            onChange={(color) => {
              update({ color: color ?? null });
            }}
          />
        </>
      );
      break;
    case 'video':
      fields = (
        <>
          <SelectProp
            label="Provider"
            value={widget.props.provider}
            options={[
              ['youtube', 'YouTube'],
              ['vimeo', 'Vimeo'],
            ]}
            onChange={(provider) => {
              update({ provider });
            }}
          />
          <TextProp
            label="Video URL or id"
            value={widget.props.videoId}
            max={300}
            onChange={(value) => {
              update({ videoId: videoIdFrom(widget.props.provider, value) });
            }}
          />
          <TextProp
            label="Title (for screen readers)"
            value={widget.props.title}
            max={200}
            onChange={(title) => {
              update({ title });
            }}
          />
          <SelectProp
            label="Aspect ratio"
            value={widget.props.aspectRatio}
            options={[
              ['16:9', '16:9'],
              ['4:3', '4:3'],
              ['1:1', '1:1'],
              ['9:16', '9:16 (vertical)'],
            ]}
            onChange={(aspectRatio) => {
              update({ aspectRatio });
            }}
          />
          <p className="text-xs text-muted-foreground">
            Played with the privacy-enhanced player; the editor shows a placeholder.
          </p>
        </>
      );
      break;
    case 'posts':
      fields = (
        <>
          <TextProp
            label="Content type key"
            value={widget.props.type}
            max={32}
            onChange={(type) => {
              update({ type });
            }}
          />
          <NumberInput
            label="Number of entries"
            value={widget.props.count}
            min={1}
            max={24}
            onChange={(count) => {
              update({ count: count ?? 3 });
            }}
          />
          <NumberInput
            label="Columns"
            value={widget.props.columns}
            min={1}
            max={4}
            onChange={(columns) => {
              update({ columns: columns ?? 3 });
            }}
          />
          <BoolProp
            label="Show images"
            value={widget.props.showImage}
            onChange={(showImage) => {
              update({ showImage });
            }}
          />
          <BoolProp
            label="Show excerpts"
            value={widget.props.showExcerpt}
            onChange={(showExcerpt) => {
              update({ showExcerpt });
            }}
          />
          <BoolProp
            label="Show dates"
            value={widget.props.showDate}
            onChange={(showDate) => {
              update({ showDate });
            }}
          />
          <p className="text-xs text-muted-foreground">
            Only published entries appear on the site.
          </p>
        </>
      );
      break;
    case 'shortcode': {
      const problems = shortcodeProblems(widget.props.code);
      fields = (
        <>
          <TextProp
            label="Shortcode"
            value={widget.props.code}
            max={2000}
            multiline
            onChange={(code) => {
              update({ code });
            }}
          />
          {problems.map((problem) => (
            <p key={problem} className="text-xs font-medium text-warning">
              {problem} It will appear as plain text.
            </p>
          ))}
          <div className="text-xs text-muted-foreground">
            <p className="mb-1 font-medium">Available shortcodes</p>
            <ul className="flex flex-col gap-1">
              {Object.entries(shortcodeRegistry).map(([name, definition]) => (
                <li key={name}>
                  <code>{definition.example}</code> — {definition.label}
                </li>
              ))}
            </ul>
          </div>
        </>
      );
      break;
    }
    case 'html':
      fields = (
        <>
          {!canEmbedHtml ? (
            <Alert tone="warning">
              <AlertDescription>
                Only users allowed to add HTML embeds can change this widget.
              </AlertDescription>
            </Alert>
          ) : null}
          <fieldset disabled={!canEmbedHtml} className="flex flex-col gap-3">
            <TextProp
              label="HTML"
              value={widget.props.html}
              max={50_000}
              multiline
              onChange={(html) => {
                update({ html });
              }}
            />
            <NumberInput
              label="Height (px)"
              value={widget.props.height}
              min={50}
              max={3000}
              onChange={(height) => {
                update({ height: height ?? 300 });
              }}
            />
            <TextProp
              label="Title (for screen readers)"
              value={widget.props.title}
              max={200}
              onChange={(title) => {
                update({ title });
              }}
            />
          </fieldset>
          <p className="text-xs text-muted-foreground">
            Runs in a sandboxed frame on the site: it cannot read the site&apos;s cookies, storage
            or pages.
          </p>
        </>
      );
      break;
  }
  return (
    <Section title={widgetLabel(widget.widget)}>
      {fields}
      {issues.length > 0 ? (
        <Alert tone="danger">
          <AlertDescription>{issues.join(' ')}</AlertDescription>
        </Alert>
      ) : null}
    </Section>
  );
}

function ColumnProps({ column }: { column: BuilderColumn }) {
  const device = useBuilderStore((state) => state.device);
  const apply = useBuilderStore((state) => state.apply);
  const width = column.width[device];
  return (
    <Section title="Column">
      <NumberInput
        label={`Width on ${DEVICE_LABELS[device].toLowerCase()} (%)`}
        value={width}
        placeholder={device === 'mobile' ? 100 : column.width.desktop}
        min={5}
        max={100}
        onChange={(value) => {
          apply(
            (document) =>
              updateElement<BuilderColumn>(document, column.id, (node) => {
                if (device === 'desktop')
                  return { ...node, width: { ...node.width, desktop: value ?? 100 } };
                const rest = withoutKey(node.width, device);
                return {
                  ...node,
                  width: value === undefined ? rest : { ...rest, [device]: value },
                };
              }),
            undefined,
            `width:${column.id}:${device}`,
          );
        }}
      />
      <SelectProp
        label="Vertical alignment"
        value={column.verticalAlign}
        options={[
          ['start', 'Top'],
          ['center', 'Middle'],
          ['end', 'Bottom'],
        ]}
        onChange={(verticalAlign) => {
          apply((document) =>
            updateElement<BuilderColumn>(document, column.id, (node) => ({
              ...node,
              verticalAlign,
            })),
          );
        }}
      />
    </Section>
  );
}

function SectionProps({ section }: { section: BuilderSection }) {
  const apply = useBuilderStore((state) => state.apply);
  return (
    <Section title="Section">
      <SelectProp
        label="Columns"
        value={section.children.length}
        options={[1, 2, 3, 4, 5, 6].map((count) => [count, String(count)] as const)}
        onChange={(count) => {
          apply((document) => setColumnCount(document, section.id, count));
        }}
      />
      <SelectProp
        label="Content width"
        value={section.layout}
        options={[
          ['boxed', 'Boxed'],
          ['full', 'Full width'],
        ]}
        onChange={(layout) => {
          apply((document) =>
            updateElement<BuilderSection>(document, section.id, (node) => ({ ...node, layout })),
          );
        }}
      />
      <NumberInput
        label="Gap between columns (px)"
        value={section.gap}
        min={0}
        max={160}
        onChange={(gap) => {
          apply(
            (document) =>
              updateElement<BuilderSection>(document, section.id, (node) => ({
                ...node,
                gap: gap ?? 0,
              })),
            undefined,
            `gap:${section.id}`,
          );
        }}
      />
    </Section>
  );
}

function ElementActions({ id, label }: { id: string; label: string }) {
  const apply = useBuilderStore((state) => state.apply);
  return (
    <div
      className="flex flex-wrap gap-1 border-b px-4 py-3"
      role="toolbar"
      aria-label={`${label} actions`}
    >
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label={`Move ${label} up`}
        onClick={() => {
          apply((document) => moveElement(document, id, -1));
        }}
      >
        <ArrowUp aria-hidden="true" />
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label={`Move ${label} down`}
        onClick={() => {
          apply((document) => moveElement(document, id, 1));
        }}
      >
        <ArrowDown aria-hidden="true" />
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          const result = duplicateElement(useBuilderStore.getState().document, id);
          if (result.id) apply(() => result.document, result.id);
        }}
      >
        <Copy aria-hidden="true" /> Duplicate
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="text-danger"
        onClick={() => {
          apply((document) => removeElement(document, id), null);
        }}
      >
        <Trash2 aria-hidden="true" /> Delete
      </Button>
    </div>
  );
}

/** Settings of the selected element, or of the page when nothing is selected. */
export function PropertiesPanel({
  canEmbedHtml,
  onMedia,
}: {
  canEmbedHtml: boolean;
  onMedia: (item: MediaItem) => void;
}) {
  const document = useBuilderStore((state) => state.document);
  const selectedId = useBuilderStore((state) => state.selectedId);
  const apply = useBuilderStore((state) => state.apply);
  const at = selectedId ? findElement(document, selectedId) : null;
  if (!at) {
    return (
      <Section title="Page">
        <BoolProp
          label="Hide the page title"
          value={document.settings.hideTitle}
          onChange={(hideTitle) => {
            apply((current) => ({ ...current, settings: { ...current.settings, hideTitle } }));
          }}
        />
        <p className="text-sm text-muted-foreground">
          Select an element on the canvas or in the navigator to edit it. Drag widgets from the
          library into a column, or select a column and click a widget.
        </p>
      </Section>
    );
  }
  const label =
    at.kind === 'widget'
      ? widgetLabel((at.node as BuilderWidget).widget)
      : at.kind === 'column'
        ? 'column'
        : 'section';
  return (
    <div>
      <ElementActions id={at.node.id} label={label} />
      {at.kind === 'widget' ? (
        <WidgetProps
          key={at.node.id}
          widget={at.node as BuilderWidget}
          canEmbedHtml={canEmbedHtml}
          onMedia={onMedia}
        />
      ) : null}
      {at.kind === 'column' ? <ColumnProps column={at.node as BuilderColumn} /> : null}
      {at.kind === 'section' ? <SectionProps section={at.node as BuilderSection} /> : null}
      <StyleForm key={`${at.node.id}:style`} id={at.node.id} styles={at.node.styles} />
    </div>
  );
}
