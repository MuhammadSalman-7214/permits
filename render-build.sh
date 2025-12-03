#!/bin/bash

# Update package index
apt-get update

# Install Chromium for Puppeteer
apt-get install -y chromium

# Install dependencies
npm install
