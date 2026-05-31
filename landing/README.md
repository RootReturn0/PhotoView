# PhotoView Landing Page

This folder contains a static landing page for early-user validation.

## Preview

Open these routes in a local static server:

- Chinese: `/zh/index.html`
- English: `/en/index.html`
- Root: `/` redirects by browser language: Chinese browsers go to `/zh/index.html`, everything else goes to `/en/index.html`.

The pages are self-contained for static hosting and reference assets from `landing/assets/`.

Chinese page:

- `assets/visual-photoview-scanning-cn.png`
- `assets/visual-photoview-detail-final.png`
- `assets/visual-photoview-settings.png`

English page:

- `assets/visual-photoview-scanning-en.png`
- `assets/visual-language-en-filters.png`
- `assets/visual-language-en-settings.png`

The responsive layout is only for viewing this web page on narrow browsers. PhotoView is presented as a desktop app, and the landing page does not use mobile app screenshots.

If you deploy only the `landing/` folder, include `landing/assets/` with it.

## Links To Replace Later

Current CTA links point to:

- Download: `https://github.com/RootReturn0/PhotoView/releases/latest`
- Feedback: `https://github.com/RootReturn0/PhotoView/issues/new`
- GitHub: `https://github.com/RootReturn0/PhotoView`
- Support: `https://github.com/sponsors/RootReturn0`

Replace these with the final download page, feedback form, sponsor profile, and demo video links before public launch if needed.

For Cloudflare Pages:

- Build command: `exit 0`
- Build output directory: `landing`
- Production branch: `main`

For GitHub Actions auto deploy, add these repository secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

After authenticating Wrangler, direct upload is also available:

```sh
wrangler pages deploy landing --project-name photoview
```

For Reddit, share the `/en/index.html` URL directly.
