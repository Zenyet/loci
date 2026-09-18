import type { Settings } from '../types';
import { AI_PROVIDERS, getProviderConfig } from '../data/aiProviders';
import { SettingGroup, SettingRow, Switch } from './SettingsControls';
import { Select } from './Select';
import { TextInput } from './TextInput';
import { AiConnectionTest } from './AiConnectionTest';

interface Props { settings: Settings; onChange: (patch: Partial<Settings>) => void }

export function AiModelSettings({ settings, onChange }: Props) {
 const providerConfig = getProviderConfig(settings.ai.provider);
 return (
<SettingGroup title="模型服务">
    <SettingRow title="服务提供商">
      <Select
        label="服务提供商"
        value={settings.ai.provider}
        options={[
          { value: "off", label: "暂不启用" },
          ...AI_PROVIDERS.map((provider) => ({
            value: provider.id,
            label: provider.name,
          })),
        ]}
        onChange={(value) => {
          const provider =
            value as typeof settings.ai.provider;
          const config = getProviderConfig(provider);
          onChange({
            ai: {
              ...settings.ai,
              provider,
              model: config?.models.some(
                (model) => model.id === settings.ai.model,
              )
                ? settings.ai.model
                : config?.models[0]?.id || "",
              baseUrl: config?.baseUrl || settings.ai.baseUrl,
            },
          });
        }}
      />
    </SettingRow>
    {settings.ai.provider !== "off" && (
      <>
        {providerConfig &&
        providerConfig.models.length > 1 ? (
          <SettingRow title="模型">
            <Select
              label="模型"
              value={settings.ai.model}
              options={providerConfig.models.map((model) => ({
                value: model.id,
                label: model.name,
                description: model.description,
              }))}
              onChange={(value) =>
                onChange({
                  ai: { ...settings.ai, model: value },
                })
              }
            />
          </SettingRow>
        ) : (
          <label className="settings-field">
            模型
            <TextInput
              value={settings.ai.model}
              placeholder="模型 ID"
              onChange={(value) =>
                onChange({
                  ai: {
                    ...settings.ai,
                    model: value,
                  },
                })
              }
            />
          </label>
        )}
        {providerConfig?.customEndpoint && (
          <label className="settings-field">
            API 地址
            <TextInput
              type="url"
              value={settings.ai.baseUrl}
              placeholder="https://api.example.com/v1"
              onChange={(value) =>
                onChange({
                  ai: {
                    ...settings.ai,
                    baseUrl: value,
                  },
                })
              }
            />
          </label>
        )}
        <label className="settings-field">
          API 密钥
          <TextInput
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={settings.ai.apiKey}
            placeholder="输入 API Key"
            onChange={(value) =>
              onChange({
                ai: {
                  ...settings.ai,
                  apiKey: value,
                },
              })
            }
          />
        </label>
      </>
    )}
    <AiConnectionTest ai={settings.ai} />
  </SettingGroup>
 );
}

export function AiGroupingPreferences({ settings, onChange }: Props) {
 return (
<SettingGroup title="整理偏好">
    <SettingRow title="分组粒度">
      <div
        className="settings-segmented"
        role="group"
        aria-label="分组粒度"
      >
        {(["coarse", "balanced", "fine"] as const).map(
          (value) => (
            <button
              type="button"
              key={value}
              aria-pressed={
                settings.grouping.granularity === value
              }
              onClick={() =>
                onChange({
                  grouping: {
                    ...settings.grouping,
                    granularity: value,
                  },
                })
              }
            >
              {value === "coarse"
                ? "精简"
                : value === "balanced"
                  ? "均衡"
                  : "细致"}
            </button>
          ),
        )}
      </div>
    </SettingRow>
    <SettingRow title="组名语言">
      <Select
        label="组名语言"
        value={settings.grouping.nameLanguage}
        options={[
          { value: "auto", label: "自动" },
          { value: "zh", label: "中文" },
          { value: "en", label: "English" },
        ]}
        onChange={(value) =>
          onChange({
            grouping: {
              ...settings.grouping,
              nameLanguage:
                value as Settings["grouping"]["nameLanguage"],
            },
          })
        }
      />
    </SettingRow>
    <SettingRow
      title="复用已有文件夹"
      hint={`少于 ${settings.grouping.minGroupSize} 个书签的分组归入「其他」`}
    >
      <Switch
        label="复用已有文件夹"
        checked={settings.grouping.reuseExisting}
        onChange={(reuseExisting) =>
          onChange({
            grouping: { ...settings.grouping, reuseExisting },
          })
        }
      />
    </SettingRow>
  </SettingGroup>
 );
}
