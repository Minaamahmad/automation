FROM node:20-slim

# Install Python + pip
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Make `python` point to python3
RUN ln -sf /usr/bin/python3 /usr/bin/python

# Install yt-dlp and curl_cffi system-wide
# (--break-system-packages is needed on Debian 12+/Python 3.11+)
RUN python3 -m pip install --no-cache-dir --break-system-packages --upgrade pip yt-dlp curl_cffi
RUN python3 -m yt_dlp --list-impersonate-targets

WORKDIR /app

# Install node deps first (better layer caching)
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the app
COPY . .

ENV NODE_ENV=production
ENV PYTHON_EXEC=python3

EXPOSE 3000

CMD ["npm", "start"]