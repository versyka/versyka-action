# Contributing

Thanks for helping. The most useful contributions are small and concrete.

## Report a missed model or a false alarm

[Open an issue](https://github.com/versyka/versyka-action/issues/new/choose) with the model ID exactly as it appears in the code, the file type, and (for a false alarm) the line that was flagged. Shutdown dates come from the vendors' own deprecation pages, so a wrong date is fixed in the public list at https://www.versyka.com/model-retirements, not in this repository; an issue here is still the right place to report it.

## Send a pull request

The action is one file, `index.mjs`, with no dependencies, so there is nothing to install or build.

1. Fork the repository and create a branch.
2. Make your change. Keep it to one thing per pull request.
3. Run it locally against any folder:

   ```sh
   INPUT_PATH=test/fixture INPUT_COMMENT=false node index.mjs
   ```

   It prints the same summary the pull request comment shows. `test/fixture` holds a file with a retired model, so you should see at least one result.
4. Check the syntax: `node --check index.mjs`.
5. Open the pull request and say what changed and why. CI runs the action on `test/fixture` and checks that it still finds the retired model.

Not sure where to start? Look at issues labelled [good first issue](https://github.com/versyka/versyka-action/labels/good%20first%20issue). Questions go in [Discussions](https://github.com/versyka/versyka-action/discussions).

## Ground rules

- Source code must never leave the runner. Only dependency manifests may be sent to the upgrade check.
- No new dependencies.
- Be kind. We answer every issue, usually within a day.

By contributing, you agree that your contribution is licensed under the MIT License.
