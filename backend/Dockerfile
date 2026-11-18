# Base image: Debian slim with Python 3.13 (same version as the local .venv)
FROM python:3.13-slim

# Do not write .pyc files and print logs right away (no buffering)
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Copy only requirements first: Docker caches this layer, so dependencies
# are reinstalled only when requirements.txt changes, not on every code edit
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Now the code (.dockerignore leaves out .venv, __pycache__ and app/.env)
COPY . .

EXPOSE 5000

# gunicorn instead of Flask's dev server; 0.0.0.0 so it is reachable from outside the container
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "2", "--access-logfile", "-", "main:app"]
