# 阶段 1：编译 sdk_cli（官方 C SDK 的 dlopen 封装）
# v3.0 SDK 基于 openssl 3.0，须用 debian bookworm 系基础镜像（自带 openssl3）
FROM node:20-bookworm AS builder
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /build
# sdk/C_sdk 内容需先从企微官方文档下载解压（见 README.md），不进 git
COPY sdk/C_sdk/WeWorkFinanceSdk_C.h sdk/C_sdk/libWeWorkFinanceSdk_C.so ./sdk/
COPY src/sdk_cli.c ./src/
RUN gcc -O2 -o sdk_cli src/sdk_cli.c -I./sdk -ldl

# 阶段 2：运行镜像（装 openssl CLI：Node 20 已禁用 crypto 的 RSA_PKCS1 私钥解密，改由 openssl pkeyutl 承担）
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /build/sdk_cli /app/bin/sdk_cli
COPY sdk/C_sdk/libWeWorkFinanceSdk_C.so /app/bin/libWeWorkFinanceSdk_C.so
COPY package.json ./
RUN npm install --omit=dev
COPY src/server.js ./src/
ENV SDK_CLI=/app/bin/sdk_cli SDK_SO=/app/bin/libWeWorkFinanceSdk_C.so PORT=80
EXPOSE 80
CMD ["node", "src/server.js"]
