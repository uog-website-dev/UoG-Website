# Contributing to the UoG Digital Platform

## Development Workflow

### Branch Naming Conventions

All branches must follow the naming pattern:

```
<ticket-type>/<issue-number>-<short-description>
```

**Ticket types:**
- `feature` - New features or functionality
- `bug` - Bug fixes
- `rbac` - Role-based access control changes
- `auth` - Authentication or identity changes
- `docs` - Documentation updates
- `chore` - Chores/refactoring
- `test` - Adding or fixing tests

**Examples:**
- `feature/123-add-organization-permissions`
- `bug/456-fix-editor-publish-error`
- `rbac/789-seed-standard-roles`
- `docs/101-update-rbac-readme`

### Commit Message Convention

All commit messages must follow the **Conventional Commits** format, linking to the Azure DevOps work item:

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat` - New feature
- `fix` - Bug fix
- `rbac` - RBAC system change
- `auth` - Authentication change
- `docs` - Documentation
- `style` - Formatting, missing semi colons, etc.
- `refactor` - Code refactoring
- `test` - Adding missing tests
- `chore` - Chores

**Subject rules:**
- Use imperative mood: "add permission" not "added permission"
- Limit to 50 characters or less
- No period at the end
- Capitalize first letter

**Body (optional):** Use blank line between subject and body. Wrap at 72 characters.

**Footer (optional):**
- **Work item link:** Always include `Closes #<issue-number>` or `Fixes #<issue-number>`
- **Breaking changes:** `BREAKING CHANGE: <description>` or `Co-Authored-By: <name>`

**Examples:**

```
feat(organizations): add organization permission codes

Implement stable permission codes for organization governance:
- platform.organizations.view
- platform.organizations.create
- platform.organizations.update
- platform.organizations.delete

Closes #123
```

```
fix(rbac): correct editor publish permission check

The editor permission gate was using realm roles instead of database-backed
assignments, causing inconsistent authorization behavior.

Closes #456
```

```
BREAKING CHANGE(auth): migrate from realm roles to database assignments

This changes the authorization model from Keycloak realm roles to database-backed
application roles. All platform-administrator assignments must be migrated.

Closes #789
```

### Pre-commit Hooks

All contributors must run `pre-commit install` after cloning the repository.
Pre-commit will automatically run on each commit to ensure:

- Code formatting (black for Python, prettier for JavaScript/TypeScript)
- Linting (ruff for Python, eslint for TypeScript)
- YAML/JSON validation
- Trailing whitespace removal
- End-of-file newline enforcement

To install:
```bash
pre-commit install
```

To run hooks on all files:
```bash
pre-commit run --all-files
```

### Code Style Standards

**Python:**
- Follow [PEP 8](https://pep8.org/) style guide
- Use [ruff](https://astral.sh/ruff/) for linting
- Format with [black](https://black.readthedocs.io/) (line length: 88)
- Sort imports with [isort](https://pycqa.github.io/isort/)
- Type annotations are required for all public APIs

**TypeScript/JavaScript:**
- Follow [Airbnb style guide](https://airbnb.io/javascript/)
- Format with [prettier](https://prettier.io/)
- Lint with [eslint](https://eslint.org/)
- Use TypeScript strict mode

**Git Commit Message Guidelines:**
- All commits must link to an Azure DevOps work item
- Use the format: `<type>(<scope>): <subject>`
- Footer must include `Closes #<issue-number>` 
- Breaking changes must be documented in the footer

### Pull Request Process

1. Create a branch from `main` following the naming convention
2. Make commits with conventional commit messages
3. Push branch and create Pull Request against `main`
4. PR must pass all pre-commit hooks
5. At least one maintainer must approve
6. Maintainer merges PR (squash and merge recommended)

### Setting Up Development Environment

```bash
# 1. Clone the repository
git clone <repo-url>
cd uog-website

# 2. Install pre-commit hooks
pre-commit install

# 3. Install backend dependencies
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements/dev.txt

# 4. Install frontend dependencies
cd ../frontend
pnpm install

# 5. Start infrastructure (Docker)
cd ..
docker-compose up -d

# 6. Run Django migrations
cd backend
DJANGO_SETTINGS_MODULE=config.settings python manage.py migrate

# 7. Create a feature branch
git checkout -b feature/123-new-feature
```

### Directory Structure

```
uog-website/
├── .editorconfig          # Coding style configuration
├── .pre-commit-config.yaml # Pre-commit hooks configuration
├── CONTRIBUTING.md        # Contribution guide
├── backend/               # Django backend
├── docker-compose.yml     # Development infrastructure
├── docs/                  # Documentation
├── frontend/              # Next.js admin console
├── infra/                 # Infrastructure configuration
├── infra/                 # Infra scripts and configs
├── infrastructure/        # Keycloak, PostgreSQL, etc.
├── scripts/               # Helper scripts
├── turbo.json             # Monorepo task graph
├── README.md              # Project overview
└── pnpm-workspace.yaml  # PNPM workspace config
```

### Code Review Checklist

Before requesting a review, ensure:

- [ ] All pre-commit hooks pass (`pre-commit run --all-files`)
- [ ] Tests pass locally (`DJANGO_SETTINGS_MODULE=config.settings pytest`)
- [ ] Code follows the style guides above
- [ ] Commit messages follow conventional commits format
- [ ] Branch name follows the naming convention
- [ ] Azure DevOps work item is linked in the PR
- [ ] No secrets or credentials in committed code
- [ ] Documentation updated if user-visible behavior changed

### Need Help?

- Ask in the team channel
- Reference the Azure DevOps Issue number in your questions
- For RBAC-specific questions, consult the architecture documentation in `docs/architecture/`