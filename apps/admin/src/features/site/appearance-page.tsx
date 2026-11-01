import {
  POSTS_PER_PAGE_MAX,
  textDirection,
  updateGeneralSettingsSchema,
  type GeneralSettings,
  type ThemeManifest,
  type ThemeSettingDefinition,
  type ThemeSettingsResponse,
} from '@nexora/shared';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  Input,
  Label,
  NativeSelect,
  Skeleton,
  Textarea,
} from '@nexora/ui';
import { CircleX, ExternalLink, Loader2 } from 'lucide-react';
import { useId, useState, type SyntheticEvent } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '../../components/page-header';
import { ApiError } from '../../lib/api-client';
import { errorMessage } from '../../lib/forms';
import { useEntries } from '../content/api';
import {
  useActivateTheme,
  useGeneralSettings,
  useSaveGeneralSettings,
  useSaveThemeSettings,
  useThemeSettings,
  useThemes,
} from './api';
import { ImageField, type ImagePreview } from './image-field';

const LANGUAGES: readonly [string, string][] = [
  ['en', 'English'],
  ['fa', 'فارسی (Persian)'],
  ['ar', 'العربية (Arabic)'],
  ['he', 'עברית (Hebrew)'],
  ['de', 'Deutsch'],
  ['fr', 'Français'],
  ['es', 'Español'],
  ['tr', 'Türkçe'],
  ['ru', 'Русский'],
  ['zh-Hans', '中文 (简体)'],
];

/** Field errors from a 422 response, keyed by the path the server reported. */
function issuesOf(error: unknown): Record<string, string> {
  const issues: Record<string, string> = {};
  if (error instanceof ApiError) {
    for (const issue of error.issues) issues[issue.path] = issue.message;
  }
  return issues;
}

function LoadError({ error }: { error: unknown }) {
  return (
    <Alert tone="danger">
      <CircleX aria-hidden="true" />
      <AlertDescription>{errorMessage(error)}</AlertDescription>
    </Alert>
  );
}

// ---------------------------------------------------------------------------------------------
// General settings
// ---------------------------------------------------------------------------------------------

function GeneralForm({ initial }: { initial: GeneralSettings }) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useSaveGeneralSettings();
  const pages = useEntries({
    type: 'page',
    status: 'published',
    search: '',
    termId: '',
    page: 1,
    sort: 'title',
    pageSize: 100,
  });
  const languageList = useId();
  const pageId = values.homepage.mode === 'page' ? values.homepage.pageId : '';

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const parsed = updateGeneralSettingsSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [issue.path.join('.'), issue.message]),
        ),
      );
      return;
    }
    setErrors({});
    save.mutate(parsed.data, {
      onSuccess: (saved) => {
        setValues(saved);
        toast.success('Site settings saved.');
      },
      onError: (error) => {
        setErrors(issuesOf(error));
        toast.error(errorMessage(error));
      },
    });
  };

  return (
    <form noValidate className="flex flex-col gap-4" onSubmit={submit}>
      <Field label="Site name" error={errors.name}>
        {(control) => (
          <Input
            {...control}
            value={values.name}
            maxLength={200}
            onChange={(event) => {
              setValues({ ...values, name: event.target.value });
            }}
          />
        )}
      </Field>
      <Field
        label="Tagline"
        description="A short line about the site, shown by the theme and used as the home page description."
        error={errors.tagline}
      >
        {(control) => (
          <Input
            {...control}
            value={values.tagline}
            maxLength={200}
            onChange={(event) => {
              setValues({ ...values, tagline: event.target.value });
            }}
          />
        )}
      </Field>
      <Field
        label="Language"
        description={`Language tag of the content (e.g. "fa" or "pt-BR"). Text direction: ${
          textDirection(values.language) === 'rtl' ? 'right to left' : 'left to right'
        }.`}
        error={errors.language}
      >
        {(control) => (
          <>
            <Input
              {...control}
              list={languageList}
              value={values.language}
              maxLength={20}
              onChange={(event) => {
                setValues({ ...values, language: event.target.value });
              }}
            />
            <datalist id={languageList}>
              {LANGUAGES.map(([tag, name]) => (
                <option key={tag} value={tag}>
                  {name}
                </option>
              ))}
            </datalist>
          </>
        )}
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Home page shows</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="homepage"
            className="accent-primary"
            checked={values.homepage.mode === 'posts'}
            onChange={() => {
              setValues({ ...values, homepage: { mode: 'posts' } });
            }}
          />
          The latest posts
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="homepage"
            className="accent-primary"
            checked={values.homepage.mode === 'page'}
            onChange={() => {
              const first = pages.data?.items[0]?.id ?? '';
              setValues({ ...values, homepage: { mode: 'page', pageId: pageId || first } });
            }}
          />
          A static page
        </label>
        {values.homepage.mode === 'page' && (
          <Field
            label="Page"
            className="ms-6"
            error={errors['homepage.pageId']}
            description="Published pages. Posts then stay available under their own address (e.g. /blog)."
          >
            {(control) => (
              <NativeSelect
                {...control}
                value={pageId}
                onChange={(event) => {
                  setValues({ ...values, homepage: { mode: 'page', pageId: event.target.value } });
                }}
              >
                <option value="" disabled>
                  {pages.isPending ? 'Loading pages…' : 'Choose a page'}
                </option>
                {(pages.data?.items ?? []).map((page) => (
                  <option key={page.id} value={page.id}>
                    {page.title || page.path}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        )}
      </fieldset>
      <Field label="Posts per page" error={errors.postsPerPage} className="max-w-40">
        {(control) => (
          <Input
            {...control}
            type="number"
            min={1}
            max={POSTS_PER_PAGE_MAX}
            value={values.postsPerPage}
            onChange={(event) => {
              setValues({ ...values, postsPerPage: Number(event.target.value) });
            }}
          />
        )}
      </Field>
      <div>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Save site settings
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// Theme settings (generated from the theme's manifest)
// ---------------------------------------------------------------------------------------------

type Values = ThemeSettingsResponse['values'];

function SettingInput({
  setting,
  value,
  preview,
  error,
  onChange,
}: {
  setting: ThemeSettingDefinition;
  value: Values[string] | undefined;
  preview: ImagePreview | null;
  error: string | undefined;
  onChange: (value: Values[string], preview?: ImagePreview | null) => void;
}) {
  const description = setting.description || undefined;
  switch (setting.type) {
    case 'color': {
      const color = typeof value === 'string' ? value : setting.default;
      return (
        <Field label={setting.label} description={description} error={error}>
          {(control) => (
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label={`${setting.label} picker`}
                className="h-9 w-12 cursor-pointer rounded-md border bg-surface p-1"
                value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#000000'}
                onChange={(event) => {
                  onChange(event.target.value);
                }}
              />
              <Input
                {...control}
                className="max-w-32 font-mono"
                value={color}
                maxLength={7}
                onChange={(event) => {
                  onChange(event.target.value);
                }}
              />
            </div>
          )}
        </Field>
      );
    }
    case 'select':
      return (
        <Field label={setting.label} description={description} error={error}>
          {(control) => (
            <NativeSelect
              {...control}
              value={typeof value === 'string' ? value : setting.default}
              onChange={(event) => {
                onChange(event.target.value);
              }}
            >
              {setting.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      );
    case 'boolean':
      return (
        <div className="flex flex-col gap-1">
          <Label className="flex items-center gap-2 font-normal">
            <Checkbox
              checked={value === true}
              onChange={(event) => {
                onChange(event.target.checked);
              }}
            />
            {setting.label}
          </Label>
          {description && <p className="ms-6 text-xs text-muted-foreground">{description}</p>}
          {error && <p className="text-xs font-medium text-danger">{error}</p>}
        </div>
      );
    case 'text':
      return (
        <Field label={setting.label} description={description} error={error}>
          {(control) =>
            setting.multiline ? (
              <Textarea
                {...control}
                maxLength={setting.maxLength}
                value={typeof value === 'string' ? value : ''}
                onChange={(event) => {
                  onChange(event.target.value);
                }}
              />
            ) : (
              <Input
                {...control}
                maxLength={setting.maxLength}
                value={typeof value === 'string' ? value : ''}
                onChange={(event) => {
                  onChange(event.target.value);
                }}
              />
            )
          }
        </Field>
      );
    case 'media':
      return (
        <ImageField
          label={setting.label}
          {...(description ? { description } : {})}
          value={preview}
          error={error}
          onChange={(image) => {
            onChange(image?.id ?? null, image);
          }}
        />
      );
  }
}

function ThemeSettingsForm({
  theme,
  initial,
}: {
  theme: ThemeManifest;
  initial: ThemeSettingsResponse;
}) {
  const [values, setValues] = useState<Values>(initial.values);
  const [previews, setPreviews] = useState<Record<string, ImagePreview | null>>(() =>
    Object.fromEntries(
      Object.entries(initial.media).map(([key, media]) => [
        key,
        { id: media.id, thumbnailUrl: media.thumbnailUrl, altText: media.altText },
      ]),
    ),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useSaveThemeSettings(theme.key);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    save.mutate(values, {
      onSuccess: (saved) => {
        setValues(saved.values);
        setErrors({});
        toast.success('Theme settings saved.');
      },
      onError: (error) => {
        const issues = issuesOf(error);
        setErrors(
          Object.fromEntries(
            Object.entries(issues).map(([path, message]) => [
              path.replace(/^values\./, ''),
              message,
            ]),
          ),
        );
        toast.error(errorMessage(error));
      },
    });
  };

  if (theme.settings.length === 0) {
    return <p className="text-sm text-muted-foreground">This theme has no settings.</p>;
  }
  return (
    <form noValidate className="flex flex-col gap-4" onSubmit={submit}>
      {theme.settings.map((setting) => (
        <SettingInput
          key={setting.key}
          setting={setting}
          value={values[setting.key]}
          preview={previews[setting.key] ?? null}
          error={errors[setting.key]}
          onChange={(value, preview) => {
            setValues((current) => ({ ...current, [setting.key]: value }));
            if (preview !== undefined)
              setPreviews((current) => ({ ...current, [setting.key]: preview }));
          }}
        />
      ))}
      <div>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Save theme settings
        </Button>
      </div>
    </form>
  );
}

function ThemeSection() {
  const themes = useThemes();
  const activate = useActivateTheme();
  const activeKey = themes.data?.activeTheme;
  const active = themes.data?.themes.find((theme) => theme.key === activeKey) ?? null;
  const settings = useThemeSettings(active?.key ?? null);

  if (themes.isPending) return <Skeleton className="h-64" />;
  if (themes.isError) return <LoadError error={themes.error} />;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Theme</CardTitle>
          <CardDescription>
            Themes control how the public site looks. Installed themes ship with the application.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {themes.data.themes.map((theme) => {
            const isActive = theme.key === themes.data.activeTheme;
            return (
              <div key={theme.key} className="flex flex-col gap-2 rounded-lg border p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">
                    {theme.name}{' '}
                    <span className="text-xs text-muted-foreground">{theme.version}</span>
                  </p>
                  {isActive ? (
                    <Badge tone="success">Active</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={activate.isPending}
                      onClick={() => {
                        activate.mutate(theme.key, {
                          onSuccess: () => toast.success(`${theme.name} is now active.`),
                          onError: (error) => toast.error(errorMessage(error)),
                        });
                      }}
                    >
                      Activate
                    </Button>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{theme.description}</p>
                {theme.menuLocations.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Menu locations:{' '}
                    {theme.menuLocations.map((location) => location.label).join(', ')}
                  </p>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
      {active && (
        <Card>
          <CardHeader>
            <CardTitle>{active.name} settings</CardTitle>
            <CardDescription>
              Colours, typography and other options offered by the theme.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {settings.isPending ? (
              <Skeleton className="h-48" />
            ) : settings.isError ? (
              <LoadError error={settings.error} />
            ) : (
              <ThemeSettingsForm key={active.key} theme={active} initial={settings.data} />
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}

export function AppearancePage() {
  const general = useGeneralSettings();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Appearance"
        description="Site identity, reading settings and the theme of the public site."
        actions={
          <a
            href="/"
            target="_blank"
            rel="noopener"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-muted"
          >
            <ExternalLink className="size-4" aria-hidden="true" />
            View site
          </a>
        }
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Site identity and reading</CardTitle>
              <CardDescription>
                How the site introduces itself and what the home page shows.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {general.isPending ? (
                <Skeleton className="h-80" />
              ) : general.isError ? (
                <LoadError error={general.error} />
              ) : (
                <GeneralForm initial={general.data} />
              )}
            </CardContent>
          </Card>
        </div>
        <div className="flex flex-col gap-6">
          <ThemeSection />
        </div>
      </div>
    </div>
  );
}
