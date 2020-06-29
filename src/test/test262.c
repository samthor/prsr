/*
 * Copyright 2020 Sam Thorogood. All rights reserved.
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

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "../token.h"
#include "../parser.h"

#include "../demo/read.c"

void modp_callback(int special) {
}

void modp_stack(int op) {
}

int main() {
  char *buf;
  int len = read_stdin(&buf);
  if (len < 0) {
    return -1;
  }

  int ret = modp_init(buf, len, 0);
  if (ret >= 0) {
    do {
      ret = modp_run();
    } while (ret > 0);
  }

  return ret;
}