/*
 * Copyright 2020 Sam Thorogood.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy of
 * the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 */

#include <stdint.h>
#include "types.h"

#ifndef _TOKEN_H
#define _TOKEN_H

typedef struct {
  char *buf;
  token cursor; // focused here
  token peek;   // peeked token, not available unless prsr_peek() called
  int line_no;  // after cursor

  // depth/flag used to record ${} state (resume literal once brace done)
  uint8_t flag;
  uint16_t depth : __STACK_SIZE_BITS;
  uint8_t stack[__STACK_SIZE];
} tokendef;

// Prepares tokendef. Provides an initial zero token.
tokendef prsr_init_token(char *);

// Moves the current cursor to the next token. This includes comments.
int prsr_next(tokendef *);

// Updates the current cursor as a different type. Important for TOKEN_SLASH.
int prsr_update(tokendef *, int);

// Peeks to the next non-comment token. Returns type and fills .peek field.
int prsr_peek(tokendef *);

#endif//_TOKEN_H