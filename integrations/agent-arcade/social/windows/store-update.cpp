#include <windows.h>
#include <appmodel.h>
#include <shobjidl.h>
#include <winrt/Windows.ApplicationModel.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Services.Store.h>

#include <atomic>
#include <cstring>

namespace {
using namespace winrt;
using namespace Windows::ApplicationModel;
using namespace Windows::Services::Store;

// Kept in the same order as the results in store-app-update.cjs.
enum Result : int32_t { Unavailable, Pending, Current, Available, Completed, Cancelled, Power, Network };
std::atomic<Result> result{Unavailable};

struct StoreApartment {
    StoreApartment() { init_apartment(apartment_type::single_threaded); }
    ~StoreApartment() { uninit_apartment(); }
};

fire_and_forget update(HWND owner, bool install) {
    try {
        StoreApartment apartment;
        auto context = StoreContext::GetDefault();
        check_hresult(context.as<IInitializeWithWindow>()->Initialize(owner));

        // Catalog association is required before an empty update list can mean current.
        auto product = co_await context.GetStoreProductForCurrentAppAsync();
        if (FAILED(product.ExtendedError()) || !product.Product()) {
            result = Unavailable;
            co_return;
        }
        auto family = Package::Current().Id().FamilyName();
        auto appUpdates = single_threaded_vector<StorePackageUpdate>();
        for (auto const& update : co_await context.GetAppAndOptionalStorePackageUpdatesAsync()) {
            if (update.Package().Id().FamilyName() == family) appUpdates.Append(update);
        }
        if (appUpdates.Size() == 0) {
            result = Current;
            co_return;
        }
        if (!install) {
            result = Available;
            co_return;
        }
        // C++/WinRT resumes the coroutine in its calling apartment. Check the
        // actual Electron UI thread again before asking Windows for consent.
        DWORD pid = 0;
        if (GetWindowThreadProcessId(owner, &pid) != GetCurrentThreadId() || pid != GetCurrentProcessId()) {
            result = Unavailable;
            co_return;
        }
        auto installed = co_await context.RequestDownloadAndInstallStorePackageUpdatesAsync(appUpdates);
        switch (installed.OverallState()) {
        case StorePackageUpdateState::Completed: result = Completed; break;
        case StorePackageUpdateState::Canceled: result = Cancelled; break;
        case StorePackageUpdateState::ErrorLowBattery: result = Power; break;
        case StorePackageUpdateState::ErrorWiFiRequired:
        case StorePackageUpdateState::ErrorWiFiRecommended: result = Network; break;
        default: result = Unavailable;
        }
    } catch (hresult_canceled const&) { result = Cancelled; }
      catch (...) { result = Unavailable; }
}

// Node-API v1 types/signatures used by this small bridge. Resolve the stable
// exports from the host so the same binary works with renamed Electron and
// does not link to a specific node.exe or Electron import library.
struct napi_env__;
struct napi_value__;
struct napi_callback_info__;
using Env = napi_env__*;
using Value = napi_value__*;
using Info = napi_callback_info__*;
using Callback = Value (*)(Env, Info);
struct NodeApi {
    int (*getArgs)(Env, Info, size_t*, Value*, Value*, void**);
    int (*getBuffer)(Env, Value, void**, size_t*);
    int (*getInt)(Env, Value, int32_t*);
    int (*createInt)(Env, int32_t, Value*);
    int (*createFunction)(Env, const char*, size_t, Callback, void*, Value*);
    int (*setProperty)(Env, Value, const char*, Value);
};
NodeApi node{};

Value read(Env env, Info) {
    Value value = nullptr;
    node.createInt(env, result.load(), &value);
    return value;
}

Value begin(Env env, Info info) {
    if (result == Pending) return read(env, info);
    result = Unavailable;
    size_t argc = 2, size = 0;
    Value args[2]{};
    void* data = nullptr;
    int32_t install = 0;
    if (node.getArgs(env, info, &argc, args, nullptr, nullptr) != 0 || argc != 2 ||
        node.getBuffer(env, args[0], &data, &size) != 0 || size != sizeof(HWND) ||
        node.getInt(env, args[1], &install) != 0 || (install != 0 && install != 1)) return read(env, info);

    HWND owner{};
    std::memcpy(&owner, data, sizeof(owner));
    DWORD pid = 0;
    UINT32 packageLength = 0;
    if (GetWindowThreadProcessId(owner, &pid) != GetCurrentThreadId() || pid != GetCurrentProcessId() ||
        GetCurrentPackageFullName(&packageLength, nullptr) != ERROR_INSUFFICIENT_BUFFER) {
        return read(env, info);
    }
    result = Pending;
    update(owner, install == 1);
    return read(env, info);
}

template<class T> bool resolve(T& target, const char* name) {
    target = reinterpret_cast<T>(GetProcAddress(GetModuleHandleW(nullptr), name));
    return target != nullptr;
}
}

extern "C" __declspec(dllexport) Value napi_register_module_v1(Env env, Value exports) {
    if (!resolve(node.getArgs, "napi_get_cb_info") || !resolve(node.getBuffer, "napi_get_buffer_info") ||
        !resolve(node.getInt, "napi_get_value_int32") || !resolve(node.createInt, "napi_create_int32") ||
        !resolve(node.createFunction, "napi_create_function") || !resolve(node.setProperty, "napi_set_named_property")) return exports;
    Value beginFunction = nullptr, resultFunction = nullptr;
    if (node.createFunction(env, "begin", 5, begin, nullptr, &beginFunction) == 0 &&
        node.createFunction(env, "result", 6, read, nullptr, &resultFunction) == 0) {
        node.setProperty(env, exports, "begin", beginFunction);
        node.setProperty(env, exports, "result", resultFunction);
    }
    return exports;
}
