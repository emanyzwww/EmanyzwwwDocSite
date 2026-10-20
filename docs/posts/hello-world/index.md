---
title: 你好，世界
date: 2026-10-19T04:09:28+08:00
tags: ['随笔']
description: 在搞机这个行业里，每个新手入门必须要经历的一个过程就是——亲手完成一个「hello, world」项目。
---

在搞机这个行业里，每个新手入门必须要经历的一个过程就是——亲手完成一个“hello, world”项目。

![hello, world](banner.png)

## “hello, world” 的由来

据我查到的资料，“hello, world”首次出现在柯林汉的内部技术文件 _A Tutorial Introduction to the Language B_ 中。在 C 语言取代 B 语言后，柯林汉在另一份内部备忘录中，用 C 语言写出了更符合现代认知的版本: `printf("hello, world");`。后来，柯林汉与丹尼斯·里奇合著的《C 程序设计语言》（_The C Programming Language_）出版。这本书极其畅销，书中第一个示例程序就是打印“hello, world”，从此奠定了它作为编程入门第一课的传统地位。

```c
int main() {
    printf("hello, world");
    return 0;
}
```

## 我怎么理解“hello, world”？

其实在我刚接触计算机的时候，也疑惑过为什么一定是打印“hello, world”？为什么不是“hello, java”“hello, javascript”？后来学这一行时间长了，突然又觉得貌似“hello, world”更好，我认为它主要好在下面几点：

1. 信息技术的爆发是人类的第三次科技革命，初学者以“hello, world”这样的语句向圈内和世界发出新生力量即将到来的信号，我认为这很有力量感和生命力；
2. 计算机这行各种方向都比较吃环境，成功打印“hello, world”字符串往往意味着初学者的基础环境都准备好了，后续不再有环境上的压力，可以好好学习相关技术。
