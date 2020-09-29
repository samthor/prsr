#include "token.h"
#include "parser.h"
#include <strings.h>
#include <stdio.h>
#include <stdlib.h>

#include "../prsr/src/demo/read.c"

static int depth = 0;

static const char *stack_names[] = {
  "null",
  "expr",
  "declare",
  "control",
  "block",
  "module",
  "function",
  "class",
  "misc",
  "label",
};

static const char *token_names[] = {
  "eof",
  "lit",
  "semicolon",
  "op",
  "colon",
  "brace",
  "array",
  "paren",
  "ternary",
  "close",
  "string",
  "regexp",
  "number",
  "symbol",
  "keyword",
  "label",
};

void blep_parser_callback(struct token *t) {
  if (t->type < 0 || t->type > _TOKEN_MAX) {
    exit(1);
  }

  char hint = ' ';
  if (t->special && !(t->special & SPECIAL__BASE)) {
    hint = '#';
  }

  printf("%-10s%c| ", token_names[t->type], hint);

  for (int i = 0; i < depth; ++i) {
    printf("  ");
  }

  printf("%.*s", t->len, t->p);

  if (t->special) {
    printf(" ~%d", t->special);
    if (t->special & SPECIAL__DECLARE) {
      printf(" declare");
    }
    if (t->special & SPECIAL__TOP) {
      printf(" top");
    }
    if (t->special & SPECIAL__PROPERTY) {
      printf(" property");
    }
    if (t->special & SPECIAL__EXTERNAL) {
      printf(" external");
    }
    if (t->special & SPECIAL__EXTERNAL) {
      printf(" change");
    }
  }

  printf("\n");
}

int blep_parser_stack(int type) {
  if (type) {
    ++depth;
    if (type < 0 || type > _STACK_MAX) {
      exit(1);
    }
    printf("%-11s>\n", stack_names[type]);
  } else {
    --depth;
    printf("           <\n");
  }
  return 0;
}

int main() {
  char *buf;
  int len = read_stdin(&buf);
  if (len < 0) {
    return -1;
  }

  int ret = blep_token_init(buf, len);
  if (ret) {
    return ret;
  }

  blep_parser_init();
  for (;;) {
    int ret = blep_parser_run();
    if (ret < 0) {
      fprintf(stderr, "!! err=%d\n", ret);
      return ret;
    } else if (ret == 0) {
      return ret;
    }
  }
}