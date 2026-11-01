import { isSafeLinkHref, type RichTextDocument } from '@nexora/shared';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Label,
  cn,
} from '@nexora/ui';
import Image from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extensions';
import {
  EditorContent,
  useEditor,
  useEditorState,
  type Editor,
  type JSONContent,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  Bold,
  Code,
  FileCode,
  Heading2,
  Heading3,
  Heading4,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';

/** Image node that remembers which media-library file it shows. */
const MediaImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      mediaId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-media-id'),
        renderHTML: (attributes: { mediaId?: string | null }) =>
          attributes.mediaId ? { 'data-media-id': attributes.mediaId } : {},
      },
    };
  },
}).configure({ inline: false, allowBase64: false });

export interface PickedImage {
  readonly id: string;
  readonly url: string;
  readonly altText: string;
}

interface RichTextEditorProps {
  readonly value: RichTextDocument;
  readonly onChange: (value: RichTextDocument) => void;
  /** Opens the media picker; resolves with the chosen image (or null if cancelled). */
  readonly onPickImage?: () => Promise<PickedImage | null>;
  readonly label: string;
  readonly invalid?: boolean;
}

function ToolbarButton({
  icon: Icon,
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn('size-8', active && 'bg-muted text-foreground')}
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className="size-4" aria-hidden="true" />
    </Button>
  );
}

function LinkDialog({
  editor,
  open,
  onOpenChange,
}: {
  editor: Editor;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link</DialogTitle>
          <DialogDescription>
            Use an http(s), mailto or tel address, or a path on this site (/about).
          </DialogDescription>
        </DialogHeader>
        {open && (
          <LinkForm
            editor={editor}
            onDone={() => {
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function LinkForm({ editor, onDone }: { editor: Editor; onDone: () => void }) {
  const current = editor.getAttributes('link') as { href?: string; target?: string | null };
  const [href, setHref] = useState(current.href ?? '');
  const [newTab, setNewTab] = useState(current.target === '_blank');
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const value = href.trim();
    if (!isSafeLinkHref(value)) {
      setError('Enter an http(s), mailto or tel address, or a path starting with /.');
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange('link')
      .setLink({ href: value, target: newTab ? '_blank' : null })
      .run();
    onDone();
  };
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      noValidate
      className="flex flex-col gap-4"
    >
      <Field label="Address" error={error ?? undefined}>
        {(control) => (
          <Input
            {...control}
            autoFocus
            value={href}
            placeholder="https://example.com"
            onChange={(event) => {
              setHref(event.target.value);
              setError(null);
            }}
          />
        )}
      </Field>
      <Label className="flex items-center gap-2 font-normal">
        <Checkbox
          checked={newTab}
          onChange={(event) => {
            setNewTab(event.target.checked);
          }}
        />
        Open in a new tab
      </Label>
      <DialogFooter>
        {current.href && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              editor.chain().focus().extendMarkRange('link').unsetLink().run();
              onDone();
            }}
          >
            Remove link
          </Button>
        )}
        <Button type="submit">Apply</Button>
      </DialogFooter>
    </form>
  );
}

/** Rich-text editor (TipTap/ProseMirror) producing the document format the API accepts. */
export function RichTextEditor({
  value,
  onChange,
  onPickImage,
  label,
  invalid = false,
}: RichTextEditorProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        link: {
          openOnClick: false,
          autolink: true,
          isAllowedUri: (url) => isSafeLinkHref(url),
          HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: null },
        },
      }),
      MediaImage,
      Placeholder.configure({ placeholder: 'Start writing…' }),
    ],
    // Same JSON shape; TipTap's type is looser about optional properties.
    content: value as unknown as JSONContent,
    editorProps: {
      attributes: {
        'aria-label': label,
        role: 'textbox',
        'aria-multiline': 'true',
        class: 'nx-prose px-4 py-3',
      },
    },
    onUpdate: ({ editor: current }) => {
      onChange(current.getJSON() as RichTextDocument);
    },
  });
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      underline: current.isActive('underline'),
      strike: current.isActive('strike'),
      code: current.isActive('code'),
      h2: current.isActive('heading', { level: 2 }),
      h3: current.isActive('heading', { level: 3 }),
      h4: current.isActive('heading', { level: 4 }),
      bulletList: current.isActive('bulletList'),
      orderedList: current.isActive('orderedList'),
      blockquote: current.isActive('blockquote'),
      codeBlock: current.isActive('codeBlock'),
      link: current.isActive('link'),
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
    }),
  });

  const insertImage = async () => {
    if (!onPickImage) return;
    const picked = await onPickImage();
    if (picked) {
      editor
        .chain()
        .focus()
        .setImage({ src: picked.url, alt: picked.altText })
        .updateAttributes('image', { mediaId: picked.id })
        .run();
    }
  };

  return (
    <div
      className={cn(
        'nx-editor rounded-lg border bg-background focus-within:ring-2 focus-within:ring-ring',
        invalid && 'border-danger',
      )}
    >
      <div
        role="toolbar"
        aria-label="Formatting"
        className="flex flex-wrap items-center gap-0.5 border-b p-1"
      >
        <ToolbarButton
          icon={Bold}
          label="Bold"
          active={state.bold}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          icon={Italic}
          label="Italic"
          active={state.italic}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          icon={Underline}
          label="Underline"
          active={state.underline}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        />
        <ToolbarButton
          icon={Strikethrough}
          label="Strikethrough"
          active={state.strike}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        />
        <ToolbarButton
          icon={Code}
          label="Inline code"
          active={state.code}
          onClick={() => editor.chain().focus().toggleCode().run()}
        />
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <ToolbarButton
          icon={Heading2}
          label="Heading 2"
          active={state.h2}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        />
        <ToolbarButton
          icon={Heading3}
          label="Heading 3"
          active={state.h3}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        />
        <ToolbarButton
          icon={Heading4}
          label="Heading 4"
          active={state.h4}
          onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
        />
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <ToolbarButton
          icon={List}
          label="Bulleted list"
          active={state.bulletList}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarButton
          icon={ListOrdered}
          label="Numbered list"
          active={state.orderedList}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarButton
          icon={Quote}
          label="Quote"
          active={state.blockquote}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        />
        <ToolbarButton
          icon={FileCode}
          label="Code block"
          active={state.codeBlock}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        />
        <ToolbarButton
          icon={Minus}
          label="Divider"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        />
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <ToolbarButton
          icon={Link2}
          label="Link"
          active={state.link}
          onClick={() => {
            setLinkOpen(true);
          }}
        />
        {onPickImage && (
          <ToolbarButton icon={ImagePlus} label="Insert image" onClick={() => void insertImage()} />
        )}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <ToolbarButton
          icon={Undo2}
          label="Undo"
          disabled={!state.canUndo}
          onClick={() => editor.chain().focus().undo().run()}
        />
        <ToolbarButton
          icon={Redo2}
          label="Redo"
          disabled={!state.canRedo}
          onClick={() => editor.chain().focus().redo().run()}
        />
      </div>
      <EditorContent editor={editor} />
      <LinkDialog editor={editor} open={linkOpen} onOpenChange={setLinkOpen} />
    </div>
  );
}
