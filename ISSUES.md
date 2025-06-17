# Open Issues

# Closed Issues

## 001 - ccr does not read initial config (Fixed in ca1b9a5)

When running `ccr start` for the first time, the application prompts for
the environment variables OPENAI_API_KEY, OPENAI_BASE_URL, and OPENAI_MODEL
and overrides any existing config file in ~/.claude-code-router/config.json
using only these values.

Desired behaviour:
- never override the config file
- first check if these variables are set as environment variables: if so, use these
- if the config file exists, and values are in config file, use these
- only if the variables are not found in env vars nor in config, add them to the config, but never override the complete config file: add them in the correct section according to the example in README.md

**Status:** Fixed - Config file is no longer overridden, environment variables are checked first, then existing config file, and only missing values are added to the config.

## 002 - ccr should print config (Fixed in ca1b9a5)

Upon launching the router, e.g. using `ccr start` or `ccr caude`, the config
values that are found should be printed to stdout

**Status:** Fixed - Config values are now printed when the router starts, including the config file path and all relevant settings.

## 003 - option for custom config path (Fixed in ca1b9a5)

The application will always look for the config file in ~/.claude-code-router/config.json .
We should add an option for specifying the path to a config file.

**Status:** Fixed - Added `--config` command line option to specify a custom config file path. Usage: `ccr start --config /path/to/config.json`

