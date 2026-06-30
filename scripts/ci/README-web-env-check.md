# iREPS Web CI Environment Check

This folder contains the web CI environment verifier.

The first safety gate for `ireps-web` is to prove that web builds do not accidentally mix DEV and TEST Firebase projects.

Expected mapping:

| Web env | Firebase project | Firebase alias |
| --- | --- | --- |
| dev | ireps2 | dev |
| test | ireps-test | test |

This check does not deploy Firebase Hosting or Functions. It only verifies configuration and runs a Vite build for each environment.
