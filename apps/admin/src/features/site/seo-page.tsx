import {
  TITLE_TEMPLATE_DEFAULT,
  updateSeoSettingsSchema,
  type SeoSettingsResponse,
} from '@nexora/shared';
import {
  Alert,
  AlertDescription,
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
  Skeleton,
  Textarea,
} from '@nexora/ui';
import { CircleX, Loader2, TriangleAlert } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { PageHeader } from '../../components/page-header';
import { ApiError } from '../../lib/api-client';
import { errorMessage } from '../../lib/forms';
import { useCapabilities } from '../auth/session';
import { useGeneralSettings, useSaveSeoSettings, useSeoSettings } from './api';
import { ImageField, type ImagePreview } from './image-field';

function SeoForm({ initial, siteName }: { initial: SeoSettingsResponse; siteName: string }) {
  const [values, setValues] = useState({
    titleTemplate: initial.titleTemplate,
    defaultDescription: initial.defaultDescription,
    indexing: initial.indexing,
  });
  const [image, setImage] = useState<ImagePreview | null>(
    initial.defaultImage
      ? {
          id: initial.defaultImage.id,
          thumbnailUrl: initial.defaultImage.thumbnailUrl,
          altText: initial.defaultImage.altText,
        }
      : null,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useSaveSeoSettings();

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const parsed = updateSeoSettingsSchema.safeParse({
      ...values,
      defaultImageId: image?.id ?? null,
    });
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
      onSuccess: () => toast.success('SEO settings saved.'),
      onError: (error) => {
        if (error instanceof ApiError) {
          setErrors(Object.fromEntries(error.issues.map((issue) => [issue.path, issue.message])));
        }
        toast.error(errorMessage(error));
      },
    });
  };

  const example = values.titleTemplate
    .replaceAll('%title%', 'Hello world')
    .replaceAll('%site%', siteName);

  return (
    <form noValidate className="flex flex-col gap-4" onSubmit={submit}>
      <Field
        label="Title template"
        description={`%title% is the page title, %site% the site name. Example: “${example}”.`}
        error={errors.titleTemplate}
      >
        {(control) => (
          <Input
            {...control}
            value={values.titleTemplate}
            maxLength={200}
            placeholder={TITLE_TEMPLATE_DEFAULT}
            onChange={(event) => {
              setValues({ ...values, titleTemplate: event.target.value });
            }}
          />
        )}
      </Field>
      <Field
        label="Default description"
        description={`Used for pages without their own description (${String(values.defaultDescription.length)}/320; search engines show about 155 characters).`}
        error={errors.defaultDescription}
      >
        {(control) => (
          <Textarea
            {...control}
            value={values.defaultDescription}
            maxLength={320}
            onChange={(event) => {
              setValues({ ...values, defaultDescription: event.target.value });
            }}
          />
        )}
      </Field>
      <ImageField
        label="Default social image"
        description="Shown when a page is shared and has no featured image. 1200 × 630 pixels works best."
        value={image}
        error={errors.defaultImageId}
        onChange={setImage}
      />
      <div className="flex flex-col gap-1">
        <Label className="flex items-center gap-2 font-normal">
          <Checkbox
            checked={values.indexing}
            onChange={(event) => {
              setValues({ ...values, indexing: event.target.checked });
            }}
          />
          Allow search engines to index this site
        </Label>
        {!values.indexing && (
          <Alert tone="warning" className="mt-2">
            <TriangleAlert aria-hidden="true" />
            <AlertDescription>
              Search engines are asked not to index any page: robots.txt disallows everything, the
              sitemap is withdrawn and every page is marked noindex.
            </AlertDescription>
          </Alert>
        )}
      </div>
      <div>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Save SEO settings
        </Button>
      </div>
    </form>
  );
}

export function SeoPage() {
  const seo = useSeoSettings();
  // The site name (for the title preview) is part of the Appearance settings; SEO managers without
  // that capability see a generic preview instead of a 403.
  const general = useGeneralSettings(useCapabilities().has('appearance.manage'));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="SEO"
        description="How the site appears in search results and when shared."
        actions={
          <Button asChild variant="outline">
            <Link to="/seo/redirects">Manage redirects</Link>
          </Button>
        }
      />
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Search and sharing</CardTitle>
          <CardDescription>
            Each entry can override its title and description and opt out of indexing in its SEO
            panel. The sitemap, robots.txt and RSS feed are generated automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {seo.isPending ? (
            <Skeleton className="h-72" />
          ) : seo.isError ? (
            <Alert tone="danger">
              <CircleX aria-hidden="true" />
              <AlertDescription>{errorMessage(seo.error)}</AlertDescription>
            </Alert>
          ) : (
            <SeoForm initial={seo.data} siteName={general.data?.name ?? 'Site'} />
          )}
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">
        Public files:{' '}
        <a className="underline" href="/sitemap.xml" target="_blank" rel="noopener">
          sitemap.xml
        </a>
        {' · '}
        <a className="underline" href="/robots.txt" target="_blank" rel="noopener">
          robots.txt
        </a>
        {' · '}
        <a className="underline" href="/feed.xml" target="_blank" rel="noopener">
          feed.xml
        </a>
      </p>
    </div>
  );
}
