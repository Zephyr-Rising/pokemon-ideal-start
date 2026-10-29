# Deploy workflow (not yet enabled)

`deploy.yml` runs the full pre-flight and publishes to GitHub Pages on every
push to `main`. It is parked here rather than in `.github/workflows/` because
GitHub refuses any push that adds or changes a file under `.github/workflows/`
unless the token carries the `workflow` scope.

To turn it on:

```bash
gh auth refresh -h github.com -s workflow
git mv .github/workflows-disabled/deploy.yml .github/workflows/deploy.yml
git commit -m "Enable the Pages deploy workflow"
git push
```

Then set **Settings → Pages → Source** to **GitHub Actions**. Until that is
done the site is published from the `gh-pages` branch instead, which needs no
extra scope — `npm run deploy` builds and pushes it.
