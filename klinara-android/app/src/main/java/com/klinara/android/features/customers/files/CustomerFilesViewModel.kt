package com.klinara.android.features.customers.files

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.files.CustomerFile
import com.klinara.android.services.files.FileGroup
import com.klinara.android.services.files.FileKind
import com.klinara.android.services.files.FilePosition
import com.klinara.android.services.files.FileUploader
import com.klinara.android.services.files.FilesService
import com.klinara.android.services.files.MockFilesService
import com.klinara.android.services.files.ThumbnailCache
import com.klinara.android.services.files.UploadStep
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class CustomerFilesUiState(
    val files: Loadable<List<CustomerFile>> = Loadable.Loading,
    /** Gruplar AYRI yükleniyor: biri düşerken diğeri boş kalmamalı. */
    val groups: Loadable<List<FileGroup>> = Loadable.Loading,
    val uploadStep: UploadStep? = null,
    val error: String? = null,
) {
    val photos: List<CustomerFile> get() = files.valueOrNull.orEmpty().filter { it.kind == FileKind.Photo }
    val documents: List<CustomerFile> get() = files.valueOrNull.orEmpty().filter { it.kind != FileKind.Photo }
    val isUploading: Boolean get() = uploadStep != null
}

/**
 * Müşteri dosyaları.
 *
 * **Kartla doğar, kartla ölür** — `CustomerRecordViewModel` ile aynı gerekçe: klinik
 * fotoğraf sağlık verisidir ve oturum ömürlü bir önbellekte yaşamamalı.
 */
class CustomerFilesViewModel(
    private val filesService: FilesService,
    val thumbnails: ThumbnailCache,
    private val uploader: FileUploader,
    private val customerId: String,
) : ViewModel() {
    private val _state = MutableStateFlow(CustomerFilesUiState())
    val state: StateFlow<CustomerFilesUiState> = _state.asStateFlow()

    fun load() {
        viewModelScope.launch {
            val files = async { Loadable.of { filesService.files(customerId) } }
            val groups = async { Loadable.of { filesService.groups(customerId) } }
            _state.update { it.copy(files = files.await(), groups = groups.await()) }
        }
    }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun upload(
        data: ByteArray,
        contentType: String,
        kind: FileKind,
        position: FilePosition = FilePosition.Other,
        groupId: String? = null,
    ) {
        if (_state.value.isUploading) return
        _state.update { it.copy(error = null) }

        viewModelScope.launch {
            try {
                uploader.upload(
                    customerId = customerId,
                    data = data,
                    contentType = contentType,
                    kind = kind,
                    position = position,
                    groupId = groupId,
                    onStep = { step -> _state.update { it.copy(uploadStep = step) } },
                )
                _state.update { it.copy(uploadStep = null) }
                afterUpload()
            } catch (error: ApiError) {
                _state.update { it.copy(uploadStep = null, error = error.displayMessage) }
            }
        }
    }

    fun createGroup(
        title: String,
        bodyArea: String?,
    ) = mutate { filesService.createGroup(customerId, title, bodyArea) }

    fun delete(fileId: String) = mutate { filesService.delete(fileId) }

    /**
     * Yükleme sonrası tazeleme — **bir kez** gecikmeli tekrar.
     *
     * Küçük görsel kuyruk işiyle üretiliyor ve birkaç saniye sürüyor. **Sonsuz yoklama
     * YOK**: sunucuyu saniyede bir dürtmek, bir yer tutucuyu birkaç saniye erken
     * kaldırmak için ödenecek bir bedel değil.
     */
    private fun afterUpload() {
        load()
        viewModelScope.launch {
            delay(THUMBNAIL_REFRESH_DELAY_MILLIS)
            load()
        }
    }

    private fun mutate(block: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                block()
                load()
            } catch (error: ApiError) {
                _state.update { it.copy(error = error.displayMessage) }
            }
        }
    }

    companion object {
        private const val THUMBNAIL_REFRESH_DELAY_MILLIS = 4_000L

        fun factory(
            container: ServiceContainer,
            customerId: String,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    CustomerFilesViewModel(
                        filesService = container.files,
                        thumbnails = container.thumbnails,
                        uploader =
                            FileUploader(
                                files = container.files,
                                uploader = container.uploader,
                                mockFiles = container.files as? MockFilesService,
                            ),
                        customerId = customerId,
                    ) as T
            }
    }
}
