#!/bin/bash

if [ -d ./.git ]; then
  cp hooks/* .git/hooks/
fi
