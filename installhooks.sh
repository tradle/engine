#!/bin/bash

if [ -d ./.git ] && [ -d ./hooks ]; then
  cp hooks/* .git/hooks/
fi
