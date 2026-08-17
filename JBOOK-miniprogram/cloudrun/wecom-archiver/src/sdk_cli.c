// 企微会话存档 C SDK 命令行封装：Node 服务（server.js）以子进程方式调用
//   sdk_cli getchat <corpid> <secret> <seq> <limit>   拉取加密会话数据，JSON 输出到 stdout
//   sdk_cli decrypt <encrypt_key> <encrypt_msg>       解密单条消息，明文输出到 stdout
// 动态加载 libWeWorkFinanceSdk_C.so（路径取环境变量 SDK_SO，默认 ./libWeWorkFinanceSdk_C.so）
// 参考官方 demo tool_testSdk.cpp 的 dlopen 模式；进程短生命周期，每次调用独立 Init/DestroySdk
#include "WeWorkFinanceSdk_C.h"
#include <dlfcn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef WeWorkFinanceSdk_t* newsdk_t();
typedef int Init_t(WeWorkFinanceSdk_t*, const char*, const char*);
typedef void DestroySdk_t(WeWorkFinanceSdk_t*);
typedef int GetChatData_t(WeWorkFinanceSdk_t*, unsigned long long, unsigned int, const char*, const char*, int, Slice_t*);
typedef int DecryptData_t(const char*, const char*, Slice_t*);
typedef Slice_t* NewSlice_t();
typedef void FreeSlice_t(Slice_t*);

static void* loadSdk(const char** err) {
    const char* soPath = getenv("SDK_SO");
    if (!soPath || !soPath[0]) soPath = "./libWeWorkFinanceSdk_C.so";
    void* handle = dlopen(soPath, RTLD_LAZY);
    if (!handle) *err = dlerror();
    return handle;
}

static int doGetChat(int argc, char* argv[]) {
    // getchat <corpid> <secret> <seq> <limit>
    if (argc < 6) {
        fprintf(stderr, "usage: sdk_cli getchat <corpid> <secret> <seq> <limit>\n");
        return 2;
    }
    const char* loadErr = NULL;
    void* so = loadSdk(&loadErr);
    if (!so) {
        fprintf(stderr, "load sdk so fail: %s\n", loadErr ? loadErr : "unknown");
        return 1;
    }

    newsdk_t* newsdk_fn = (newsdk_t*)dlsym(so, "NewSdk");
    Init_t* init_fn = (Init_t*)dlsym(so, "Init");
    DestroySdk_t* destroysdk_fn = (DestroySdk_t*)dlsym(so, "DestroySdk");
    GetChatData_t* getchatdata_fn = (GetChatData_t*)dlsym(so, "GetChatData");
    NewSlice_t* newslice_fn = (NewSlice_t*)dlsym(so, "NewSlice");
    FreeSlice_t* freeslice_fn = (FreeSlice_t*)dlsym(so, "FreeSlice");
    if (!newsdk_fn || !init_fn || !destroysdk_fn || !getchatdata_fn || !newslice_fn || !freeslice_fn) {
        fprintf(stderr, "dlsym fail: %s\n", dlerror());
        return 1;
    }

    WeWorkFinanceSdk_t* sdk = newsdk_fn();
    int ret = init_fn(sdk, argv[2], argv[3]);
    if (ret != 0) {
        destroysdk_fn(sdk);
        fprintf(stderr, "init sdk err ret:%d\n", ret);
        return 1;
    }

    unsigned long long seq = strtoull(argv[4], NULL, 10);
    unsigned int limit = (unsigned int)strtoul(argv[5], NULL, 10);
    if (limit < 1 || limit > 1000) limit = 500;

    // 不使用代理（proxy/passwd 传空字符串），超时 5 秒
    Slice_t* chatDatas = newslice_fn();
    ret = getchatdata_fn(sdk, seq, limit, "", "", 5, chatDatas);
    if (ret != 0) {
        freeslice_fn(chatDatas);
        destroysdk_fn(sdk);
        fprintf(stderr, "GetChatData err ret:%d\n", ret);
        return 1;
    }

    // Slice_t 直接含 buf/len（见官方 demo），JSON 原样输出
    fwrite(chatDatas->buf, 1, chatDatas->len, stdout);
    fputc('\n', stdout);

    freeslice_fn(chatDatas);
    destroysdk_fn(sdk);
    return 0;
}

static int doDecrypt(int argc, char* argv[]) {
    // decrypt <encrypt_key> <encrypt_msg>；DecryptData 是纯工具函数，无需 NewSdk/Init
    if (argc < 4) {
        fprintf(stderr, "usage: sdk_cli decrypt <encrypt_key> <encrypt_msg>\n");
        return 2;
    }
    const char* loadErr = NULL;
    void* so = loadSdk(&loadErr);
    if (!so) {
        fprintf(stderr, "load sdk so fail: %s\n", loadErr ? loadErr : "unknown");
        return 1;
    }

    DecryptData_t* decrypt_fn = (DecryptData_t*)dlsym(so, "DecryptData");
    NewSlice_t* newslice_fn = (NewSlice_t*)dlsym(so, "NewSlice");
    FreeSlice_t* freeslice_fn = (FreeSlice_t*)dlsym(so, "FreeSlice");
    if (!decrypt_fn || !newslice_fn || !freeslice_fn) {
        fprintf(stderr, "dlsym fail: %s\n", dlerror());
        return 1;
    }

    Slice_t* msg = newslice_fn();
    int ret = decrypt_fn(argv[2], argv[3], msg);
    if (ret != 0) {
        freeslice_fn(msg);
        fprintf(stderr, "DecryptData err ret:%d\n", ret);
        return 1;
    }

    fwrite(msg->buf, 1, msg->len, stdout);
    fputc('\n', stdout);
    freeslice_fn(msg);
    return 0;
}

int main(int argc, char* argv[]) {
    if (argc < 2) {
        fprintf(stderr, "usage: sdk_cli getchat <corpid> <secret> <seq> <limit> | decrypt <encrypt_key> <encrypt_msg>\n");
        return 2;
    }
    if (strcmp(argv[1], "getchat") == 0) return doGetChat(argc, argv);
    if (strcmp(argv[1], "decrypt") == 0) return doDecrypt(argc, argv);
    fprintf(stderr, "unknown command: %s\n", argv[1]);
    return 2;
}
