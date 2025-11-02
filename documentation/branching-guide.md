# Git Branching Workflow

To maintain clear and structured use of GitHub branches, we adopt the following workflow:

## Branch Overview

| Branch Name | Purpose | Based off of | Merges into |
|-------------|---------|--------------|-------------|
| `main` | Production-ready, stable code. No active development/manually commits here. | - | - |
| `dev` | Ongoing development for future deployments/releases. | `main` (initially) | `main` |
| `feature/<feature-name>` | Specific features/tasks. Temporary branches. | `dev` | `dev` |
| `hotfix/<bug-fix-name>` | Quick, urgent bug fixes for production. | `main` | Both `main` and `dev` |

---

## Typical Workflow (with Git commands)

### 1. Initial Repository Setup:

If your repository already has extra branches, skip to next section. For a new repository setting up the first time:

```bash
# starting from main branch, create the dev branch and push it to github
git checkout -b dev
git push -u origin dev
```

### 2. Regular Development Workflow:

**Always start from dev branch!**

```bash
# update your local dev branch
git checkout dev
git pull origin dev

# create a new feature branch
git checkout -b feature/my-awesome-feature dev

# Do your development work, commit regularly
git add .
git commit -m "Some meaningful commit message."

# Push feature branch to GitHub (optional, but recommended for backup or collaboration)
git push -u origin feature/my-awesome-feature

# once feature complete and tested, merge back to dev:
git checkout dev
git pull origin dev
git merge feature/my-awesome-feature

# push merged dev branch to GitHub
git push origin dev

# Cleanup the temporary feature branch:
git branch -d feature/my-awesome-feature  # delete locally
git push origin --delete feature/my-awesome-feature  # delete remotely
```

### 3. Merge dev into main (Deployments/Releases):

When you have stable code ready for production:

```bash
# switch to main and merge dev branch into it:
git checkout main
git pull origin main
git merge dev

# Push updated main branch to GitHub
git push origin main
```

### 4. Production hotfixes:

When you discover an urgent production issue in your main branch:

```bash
# create hotfix branch off main
git checkout main
git pull origin main
git checkout -b hotfix/urgent-production-bug main

# fix the code, commit fix
git add .
git commit -m "Fix critical bug XYZ"

# merge hotfix to main
git checkout main
git merge hotfix/urgent-production-bug
git push origin main

# also merge hotfix into dev
git checkout dev
git pull origin dev
git merge hotfix/urgent-production-bug
git push origin dev

# Cleanup hotfix branch:
git branch -d hotfix/urgent-production-bug
git push origin --delete hotfix/urgent-production-bug
```

---

## Custom Aliases (Optional but recommended):

To save time, Git allows adding custom commands as aliases. You can set this up easily:

```bash
# add custom alias for creating new feature branch:
git config --global alias.newfeature '!f() { git checkout dev && git pull origin dev && git checkout -b feature/$1; }; f'

# Usage:
git newfeature login-system
# <-- Does the same as checkout dev, pull extras, and create a branch named "feature/login-system">
```

---

## NodeJS & additional recommendations:

- Ensure consistent testing on the dev branch before merging features.
- For NodeJS specifically:
  - Install dependencies frequently after branch checkouts (`npm install` or `npm ci`).
  - Create automated tests to make sure features don't negatively affect existing functionality (`npm test`).

---

### Final Thoughts:
By following these structured branching mechanisms, you'll ensure that your project's changes are clearly organized, reduces merge conflicts, and simplifies managing feature delivery and releases across projects you develop going forward.